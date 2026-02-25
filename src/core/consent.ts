import type { ActionLogData } from '../protocols/audit.js';
import type { PaginationCursor, ProtocolDefinition } from '@enbox/dwn-sdk-js';
import type { SchemaMap, TypedProtocol, TypedWeb5, Web5 } from '@enbox/api';

import { AuditProtocol } from '../protocols/audit.js';
import { DateSort } from '@enbox/dwn-sdk-js';
import { MemoryProtocol } from '../protocols/memory.js';

// ---------------------------------------------------------------------------
// Extract definition and schema map types from the typed protocols
// ---------------------------------------------------------------------------

type InferDef<P> = P extends TypedProtocol<infer D, infer _M> ? D : ProtocolDefinition;
type InferMap<P> = P extends TypedProtocol<infer _D, infer M> ? M : SchemaMap;

type MemoryDef = InferDef<typeof MemoryProtocol>;
type MemoryMap = InferMap<typeof MemoryProtocol>;
type MemoryTyped = TypedWeb5<MemoryDef, MemoryMap>;

type AuditDef = InferDef<typeof AuditProtocol>;
type AuditMap = InferMap<typeof AuditProtocol>;
type AuditTyped = TypedWeb5<AuditDef, AuditMap>;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type AgentScope = {
  protocol : string;
  path : string;
  actions : string[];
};

export type AgentRegistration = {
  did : string;
  name : string;
  description? : string;
  scopes : AgentScope[];
  grantedAt : string;
};

export type AgentRecord = {
  id : string;
  data : AgentRegistration;
  dateCreated : string;
};

export type AuditLogRecord = {
  id : string;
  data : ActionLogData;
  tags : {
    agentDid : string;
    action : string;
    targetProtocol : string;
    targetRecordId : string;
    status : string;
  };
  dateCreated : string;
};

// ---------------------------------------------------------------------------
// Internal tag record alias
// ---------------------------------------------------------------------------

type TagRecord = Record<string, string | number | boolean | string[] | number[]>;

// ---------------------------------------------------------------------------
// ConsentManager
// ---------------------------------------------------------------------------

export class ConsentManager {
  private readonly memoryTyped : MemoryTyped;
  private readonly auditTyped : AuditTyped;
  private memoryConfigured = false;
  private auditConfigured = false;

  constructor(web5: Web5) {
    this.memoryTyped = web5.using(MemoryProtocol);
    this.auditTyped = web5.using(AuditProtocol);
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private async ensureMemoryConfigured(): Promise<void> {
    if (!this.memoryConfigured) {
      await this.memoryTyped.configure({ encryption: true });
      this.memoryConfigured = true;
    }
  }

  private async ensureAuditConfigured(): Promise<void> {
    if (!this.auditConfigured) {
      await this.auditTyped.configure();
      this.auditConfigured = true;
    }
  }

  // -------------------------------------------------------------------------
  // Agent registration
  // -------------------------------------------------------------------------

  async registerAgent(agentDid: string, name: string, opts?: {
    description? : string;
    scopes? : AgentScope[];
  }): Promise<AgentRecord> {
    await this.ensureMemoryConfigured();

    const now = new Date().toISOString();
    const registration: AgentRegistration = {
      did         : agentDid,
      name,
      description : opts?.description,
      scopes      : opts?.scopes ?? [],
      grantedAt   : now,
    };

    const { status, record } = await this.memoryTyped.records.create('fact', {
      data       : { content: JSON.stringify(registration) },
      tags       : { category: '_agent', source: 'system', status: 'active' },
      encryption : true,
    });

    if (status.code !== 202) {
      throw new Error(`registerAgent failed: ${status.code} ${status.detail}`);
    }

    return {
      id          : record.id,
      data        : registration,
      dateCreated : record.dateCreated,
    };
  }

  // -------------------------------------------------------------------------
  // Listing agents
  // -------------------------------------------------------------------------

  async listAgents(): Promise<AgentRecord[]> {
    await this.ensureMemoryConfigured();

    const { status, records } = await this.memoryTyped.records.query('fact', {
      filter     : { tags: { category: '_agent', source: 'system', status: 'active' } },
      dateSort   : DateSort.CreatedDescending,
      encryption : true,
    });

    if (status.code !== 200) {
      throw new Error(`listAgents failed: ${status.code} ${status.detail}`);
    }

    const results: AgentRecord[] = [];
    for (const record of records) {
      const raw = await record.data.json() as { content: string };
      const registration = JSON.parse(raw.content) as AgentRegistration;
      results.push({
        id          : record.id,
        data        : registration,
        dateCreated : record.dateCreated,
      });
    }

    return results;
  }

  // -------------------------------------------------------------------------
  // Get single agent
  // -------------------------------------------------------------------------

  async getAgent(agentDid: string): Promise<AgentRecord | undefined> {
    const agents = await this.listAgents();
    return agents.find(a => a.data.did === agentDid);
  }

  // -------------------------------------------------------------------------
  // Revoking agents
  // -------------------------------------------------------------------------

  async revokeAgent(agentDid: string): Promise<boolean> {
    await this.ensureMemoryConfigured();

    const { status, records } = await this.memoryTyped.records.query('fact', {
      filter     : { tags: { category: '_agent', source: 'system', status: 'active' } },
      dateSort   : DateSort.CreatedDescending,
      encryption : true,
    });

    if (status.code !== 200) {
      throw new Error(`revokeAgent query failed: ${status.code} ${status.detail}`);
    }

    let revoked = false;
    for (const record of records) {
      const raw = await record.data.json() as { content: string };
      const registration = JSON.parse(raw.content) as AgentRegistration;
      if (registration.did === agentDid) {
        const { status: delStatus } = await this.memoryTyped.records.delete('fact', {
          recordId: record.id,
        });
        if (delStatus.code !== 202) {
          throw new Error(`revokeAgent delete failed: ${delStatus.code} ${delStatus.detail}`);
        }
        revoked = true;
      }
    }

    return revoked;
  }

  // -------------------------------------------------------------------------
  // Audit log queries
  // -------------------------------------------------------------------------

  async getAgentAuditLog(agentDid: string, limit?: number): Promise<AuditLogRecord[]> {
    await this.ensureAuditConfigured();

    const { status, records } = await this.auditTyped.records.query('actionLog', {
      filter     : { tags: { agentDid } },
      dateSort   : DateSort.CreatedDescending,
      pagination : limit ? { limit } as { limit: number; cursor?: PaginationCursor } : undefined,
    });

    if (status.code !== 200) {
      throw new Error(`getAgentAuditLog failed: ${status.code} ${status.detail}`);
    }

    const results: AuditLogRecord[] = [];
    for (const record of records) {
      const data = await record.data.json() as ActionLogData;
      const tags = record.tags as TagRecord | undefined;
      results.push({
        id   : record.id,
        data,
        tags : {
          agentDid       : tags?.agentDid as string,
          action         : tags?.action as string,
          targetProtocol : tags?.targetProtocol as string,
          targetRecordId : tags?.targetRecordId as string,
          status         : tags?.status as string,
        },
        dateCreated: record.dateCreated,
      });
    }

    return results;
  }
}
