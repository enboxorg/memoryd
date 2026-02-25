// Tests that audit logging is wired through MCP tool calls when auditTyped is
// provided, and that ConsentManager is instantiated alongside the agent context.

import { rmSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Web5 } from '@enbox/api';
import { Web5UserAgent } from '@enbox/agent';

import { AuditProtocol } from '../../../src/protocols/audit.js';
import { ConsentManager } from '../../../src/core/consent.js';
import { MemorydServer } from '../../../src/mcp/server.js';
import { MemoryProtocol } from '../../../src/protocols/memory.js';
import { MemoryStore } from '../../../src/core/memory-store.js';
import { registerMemoryTools } from '../../../src/mcp/tools/memory-tools.js';

import type { AuditTyped } from '../../../src/cli/agent.js';

const DATA_PATH = '__TESTDATA__/audit-wiring';

describe('audit wiring via MCP tools', () => {
  let server: MemorydServer;
  let client: Client;
  let web5: Web5;
  let auditTyped: AuditTyped;
  let consentManager: ConsentManager;

  beforeAll(async () => {
    rmSync(DATA_PATH, { recursive: true, force: true });

    const agent = await Web5UserAgent.create({ dataPath: DATA_PATH });
    await agent.initialize({ password: 'test' });
    await agent.start({ password: 'test' });

    const identities = await agent.identity.list();
    let identity = identities[0];
    if (!identity) {
      identity = await agent.identity.create({
        didMethod  : 'dht',
        metadata   : { name: 'Test' },
        didOptions : {
          verificationMethods: [
            {
              algorithm : 'Ed25519',
              id        : 'sig',
              purposes  : ['assertionMethod', 'authentication'],
            },
            {
              algorithm : 'X25519',
              id        : 'enc',
              purposes  : ['keyAgreement'],
            },
          ],
        },
      });
    }

    const result = await Web5.connect({
      agent,
      connectedDid : identity.did.uri,
      sync         : 'off',
    });
    web5 = result.web5;

    // Configure protocols.
    const memoryTyped = web5.using(MemoryProtocol);
    await memoryTyped.configure({ encryption: true });

    auditTyped = web5.using(AuditProtocol) as unknown as AuditTyped;
    await auditTyped.configure();

    consentManager = new ConsentManager(web5);

    // Create store and register tools WITH auditTyped.
    const store = new MemoryStore(web5);
    server = new MemorydServer({ port: 0 });
    registerMemoryTools(server, store, undefined, auditTyped);
    const httpResult = await server.startHttp();

    client = new Client({ name: 'test-audit', version: '0.1.0' });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://localhost:${httpResult.port}/mcp`),
    );
    await client.connect(transport);
  }, 30_000);

  afterAll(async () => {
    await client?.close();
    await server?.stop();
    rmSync(DATA_PATH, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Audit log written on tool call
  // -------------------------------------------------------------------------

  it('writes an audit log entry when memory_add_fact is called', async () => {
    const result = await client.callTool({
      name      : 'memory_add_fact',
      arguments : {
        content  : 'Audit test fact',
        category : 'audit-test',
        source   : 'agent',
      },
    });

    expect(result.isError).toBeFalsy();

    // Query the audit log for the entry.
    const logs = await consentManager.getAgentAuditLog('self', 10);
    const match = logs.find(l =>
      l.tags.action === 'memory_add_fact' &&
      l.tags.targetProtocol === 'memory/v1',
    );

    expect(match).toBeDefined();
    expect(match!.tags.status).toBe('success');
    expect(match!.data.description).toContain('Audit test fact');
  }, 30_000);

  it('writes an audit log entry when memory_add_preference is called', async () => {
    const result = await client.callTool({
      name      : 'memory_add_preference',
      arguments : {
        content : 'Prefer dark mode always',
        domain  : 'ui',
      },
    });

    expect(result.isError).toBeFalsy();

    const logs = await consentManager.getAgentAuditLog('self', 10);
    const match = logs.find(l =>
      l.tags.action === 'memory_add_preference' &&
      l.tags.targetProtocol === 'memory/v1',
    );

    expect(match).toBeDefined();
    expect(match!.tags.status).toBe('success');
  }, 30_000);

  it('writes an audit log entry when memory_search is called', async () => {
    // Search falls back to listFacts when no search index.
    const result = await client.callTool({
      name      : 'memory_search',
      arguments : { category: 'audit-test' },
    });

    expect(result.isError).toBeFalsy();

    const logs = await consentManager.getAgentAuditLog('self', 20);
    const match = logs.find(l => l.tags.action === 'memory_search');

    expect(match).toBeDefined();
    expect(match!.tags.status).toBe('success');
  }, 30_000);

  // -------------------------------------------------------------------------
  // ConsentManager instantiation
  // -------------------------------------------------------------------------

  it('ConsentManager can be created alongside audit wiring', () => {
    expect(consentManager).toBeDefined();
    expect(typeof consentManager.listAgents).toBe('function');
    expect(typeof consentManager.getAgent).toBe('function');
    expect(typeof consentManager.revokeAgent).toBe('function');
    expect(typeof consentManager.getAgentAuditLog).toBe('function');
  });

  it('ConsentManager agent registration and listing works', async () => {
    const reg = await consentManager.registerAgent('did:example:test-agent', 'TestBot', {
      description : 'A test agent',
      scopes      : [{
        protocol : 'memory/v1',
        path     : 'fact',
        actions  : ['create', 'read'],
      }],
    });

    expect(reg.id).toBeDefined();
    expect(reg.data.did).toBe('did:example:test-agent');
    expect(reg.data.name).toBe('TestBot');

    const agents = await consentManager.listAgents();
    expect(agents.length).toBeGreaterThanOrEqual(1);

    const found = await consentManager.getAgent('did:example:test-agent');
    expect(found).toBeDefined();
    expect(found!.data.name).toBe('TestBot');
  }, 30_000);
});
