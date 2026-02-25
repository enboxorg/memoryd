import type { FactData, PreferenceData, RelationshipData } from '../protocols/memory.js';
import type { PaginationCursor, ProtocolDefinition } from '@enbox/dwn-sdk-js';
import type { SchemaMap, TypedProtocol, TypedWeb5, Web5 } from '@enbox/api';

import { DateSort } from '@enbox/dwn-sdk-js';
import { MemoryProtocol } from '../protocols/memory.js';

// ---------------------------------------------------------------------------
// Extract definition and schema map types from the typed protocol
// ---------------------------------------------------------------------------

type InferDef<P> = P extends TypedProtocol<infer D, infer _M> ? D : ProtocolDefinition;
type InferMap<P> = P extends TypedProtocol<infer _D, infer M> ? M : SchemaMap;

type MemoryDef = InferDef<typeof MemoryProtocol>;
type MemoryMap = InferMap<typeof MemoryProtocol>;
type MemoryTyped = TypedWeb5<MemoryDef, MemoryMap>;

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type RecordResult = {
  id : string;
  contextId : string | undefined;
  status : { code: number; detail: string };
};

export type FactRecord = {
  id : string;
  contextId : string | undefined;
  data : FactData;
  tags : { category: string; source: string; confidence?: number; status?: string; collection?: string };
  dateCreated : string;
};

export type PreferenceRecord = {
  id : string;
  contextId : string | undefined;
  data : PreferenceData;
  tags : { domain: string; collection?: string };
  dateCreated : string;
};

export type RelationshipRecord = {
  id : string;
  contextId : string | undefined;
  data : RelationshipData;
  tags : { name: string; type: string; collection?: string };
  dateCreated : string;
};

export type ListResult<T> = {
  records : T[];
  cursor? : PaginationCursor;
};

export type FactFilters = {
  category? : string;
  source? : string;
  status? : string;
  collection? : string;
};

export type PreferenceFilters = {
  domain? : string;
  collection? : string;
};

export type RelationshipFilters = {
  name? : string;
  type? : string;
  collection? : string;
};

export type PaginationOptions = {
  limit? : number;
  cursor? : PaginationCursor;
};

// ---------------------------------------------------------------------------
// Tag record alias
// ---------------------------------------------------------------------------

type TagRecord = Record<string, string | number | boolean | string[] | number[]>;

// ---------------------------------------------------------------------------
// MemoryStore class
// ---------------------------------------------------------------------------

export class MemoryStore {
  private readonly typed: MemoryTyped;
  private configured = false;

  constructor(web5: Web5) {
    this.typed = web5.using(MemoryProtocol);
  }

  /** Ensure the protocol is configured (idempotent). */
  private async ensureConfigured(): Promise<void> {
    if (!this.configured) {
      await this.typed.configure({ encryption: true });
      this.configured = true;
    }
  }

  // -------------------------------------------------------------------------
  // Facts
  // -------------------------------------------------------------------------

  async addFact(content: string, category: string, source: string, opts?: {
    context? : string;
    confidence? : number;
    collection? : string;
  }): Promise<RecordResult> {
    await this.ensureConfigured();
    const tags: Record<string, string | number> = {
      category,
      source,
      status: 'active',
    };
    if (opts?.confidence !== undefined) { tags.confidence = opts.confidence; }
    if (opts?.collection !== undefined) { tags.collection = opts.collection; }

    const { status, record } = await this.typed.records.create('fact', {
      data       : { content, context: opts?.context },
      tags,
      encryption : true,
    });

    if (status.code !== 202) {
      throw new Error(`addFact failed: ${status.code} ${status.detail}`);
    }

    return { id: record.id, contextId: record.contextId, status };
  }

  async getFact(recordId: string): Promise<FactRecord> {
    await this.ensureConfigured();
    const { status, record } = await this.typed.records.read('fact', {
      filter     : { recordId },
      encryption : true,
    });

    if (status.code !== 200) {
      throw new Error(`getFact failed: ${status.code} ${status.detail}`);
    }

    const data = await record.data.json() as FactData;
    const tags = record.tags as TagRecord | undefined;

    return {
      id        : record.id,
      contextId : record.contextId,
      data,
      tags      : {
        category   : tags?.category as string,
        source     : tags?.source as string,
        confidence : tags?.confidence as number | undefined,
        status     : tags?.status as string | undefined,
        collection : tags?.collection as string | undefined,
      },
      dateCreated: record.dateCreated,
    };
  }

  async listFacts(filters?: FactFilters, pagination?: PaginationOptions): Promise<ListResult<FactRecord>> {
    await this.ensureConfigured();
    const tags: Record<string, string | number> = {};
    if (filters?.category !== undefined) { tags.category = filters.category; }
    if (filters?.source !== undefined) { tags.source = filters.source; }
    if (filters?.status !== undefined) { tags.status = filters.status; }
    if (filters?.collection !== undefined) { tags.collection = filters.collection; }

    const { status, records, cursor } = await this.typed.records.query('fact', {
      filter     : Object.keys(tags).length > 0 ? { tags } : undefined,
      dateSort   : DateSort.CreatedDescending,
      pagination,
      encryption : true,
    });

    if (status.code !== 200) {
      throw new Error(`listFacts failed: ${status.code} ${status.detail}`);
    }

    const results: FactRecord[] = [];
    for (const record of records) {
      const data = await record.data.json() as FactData;
      const rTags = record.tags as TagRecord | undefined;
      results.push({
        id        : record.id,
        contextId : record.contextId,
        data,
        tags      : {
          category   : rTags?.category as string,
          source     : rTags?.source as string,
          confidence : rTags?.confidence as number | undefined,
          status     : rTags?.status as string | undefined,
          collection : rTags?.collection as string | undefined,
        },
        dateCreated: record.dateCreated,
      });
    }

    return { records: results, cursor };
  }

  async updateFact(recordId: string, updates: {
    content? : string;
    context? : string;
    confidence? : number;
    status? : string;
  }): Promise<RecordResult> {
    await this.ensureConfigured();
    const { status: readStatus, record } = await this.typed.records.read('fact', {
      filter     : { recordId },
      encryption : true,
    });

    if (readStatus.code !== 200) {
      throw new Error(`updateFact read failed: ${readStatus.code} ${readStatus.detail}`);
    }

    const existingData = await record.data.json() as FactData;
    const existingTags = record.tags as TagRecord | undefined;

    const newData: FactData = {
      content : updates.content ?? existingData.content,
      context : updates.context ?? existingData.context,
    };

    const newTags: Record<string, string | number> = {
      category : existingTags?.category as string,
      source   : existingTags?.source as string,
    };
    if (updates.confidence !== undefined) {
      newTags.confidence = updates.confidence;
    } else if (existingTags?.confidence !== undefined) {
      newTags.confidence = existingTags.confidence as number;
    }
    if (updates.status !== undefined) {
      newTags.status = updates.status;
    } else if (existingTags?.status !== undefined) {
      newTags.status = existingTags.status as string;
    }
    if (existingTags?.collection !== undefined) {
      newTags.collection = existingTags.collection as string;
    }

    const { status, record: updated } = await record.update({
      data       : newData,
      tags       : newTags,
      encryption : true,
    });

    if (status.code !== 202) {
      throw new Error(`updateFact failed: ${status.code} ${status.detail}`);
    }

    return { id: updated.id, contextId: updated.contextId, status };
  }

  async supersedeFact(oldRecordId: string, newContent: string, opts?: {
    category? : string;
    source? : string;
    reason? : string;
    confidence? : number;
    collection? : string;
  }): Promise<RecordResult> {
    await this.ensureConfigured();
    // 1. Read the old fact to get its tags
    const { status: readStatus, record: oldRecord } = await this.typed.records.read('fact', {
      filter     : { recordId: oldRecordId },
      encryption : true,
    });

    if (readStatus.code !== 200) {
      throw new Error(`supersedeFact read failed: ${readStatus.code} ${readStatus.detail}`);
    }

    const oldTags = oldRecord.tags as TagRecord | undefined;

    // 2. Create a new fact (inheriting category/source unless overridden)
    const newTags: Record<string, string | number> = {
      category : (opts?.category ?? oldTags?.category) as string,
      source   : (opts?.source ?? oldTags?.source) as string,
      status   : 'active',
    };
    if (opts?.confidence !== undefined) { newTags.confidence = opts.confidence; }
    if (opts?.collection !== undefined) {
      newTags.collection = opts.collection;
    } else if (oldTags?.collection !== undefined) {
      newTags.collection = oldTags.collection as string;
    }

    const { status: createStatus, record: newRecord } = await this.typed.records.create('fact', {
      data       : { content: newContent },
      tags       : newTags,
      encryption : true,
    });

    if (createStatus.code !== 202) {
      throw new Error(`supersedeFact create failed: ${createStatus.code} ${createStatus.detail}`);
    }

    // 3. Write a supersession sub-record on the old fact
    const { status: supersessionStatus } = await this.typed.records.create('fact/supersession', {
      data            : { reason: opts?.reason },
      tags            : { supersededBy: newRecord.id },
      parentContextId : oldRecord.contextId,
    });

    if (supersessionStatus.code !== 202) {
      throw new Error(`supersedeFact supersession failed: ${supersessionStatus.code} ${supersessionStatus.detail}`);
    }

    // 4. Update the old fact's status tag to 'superseded'
    const oldData = await oldRecord.data.json() as FactData;
    const updateTags: Record<string, string | number> = {
      category : oldTags?.category as string,
      source   : oldTags?.source as string,
      status   : 'superseded',
    };
    if (oldTags?.confidence !== undefined) { updateTags.confidence = oldTags.confidence as number; }
    if (oldTags?.collection !== undefined) { updateTags.collection = oldTags.collection as string; }

    const { status: updateStatus } = await oldRecord.update({
      data       : oldData,
      tags       : updateTags,
      encryption : true,
    });

    if (updateStatus.code !== 202) {
      throw new Error(`supersedeFact update old failed: ${updateStatus.code} ${updateStatus.detail}`);
    }

    // 5. Return the new fact's RecordResult
    return { id: newRecord.id, contextId: newRecord.contextId, status: createStatus };
  }

  async deleteFact(recordId: string): Promise<void> {
    await this.ensureConfigured();
    const { status } = await this.typed.records.delete('fact', { recordId });

    if (status.code !== 202) {
      throw new Error(`deleteFact failed: ${status.code} ${status.detail}`);
    }
  }

  // -------------------------------------------------------------------------
  // Preferences
  // -------------------------------------------------------------------------

  async addPreference(content: string, domain: string, opts?: {
    context? : string;
    collection? : string;
  }): Promise<RecordResult> {
    await this.ensureConfigured();
    const tags: Record<string, string> = { domain };
    if (opts?.collection !== undefined) { tags.collection = opts.collection; }

    const { status, record } = await this.typed.records.create('preference', {
      data       : { content, context: opts?.context },
      tags,
      encryption : true,
    });

    if (status.code !== 202) {
      throw new Error(`addPreference failed: ${status.code} ${status.detail}`);
    }

    return { id: record.id, contextId: record.contextId, status };
  }

  async listPreferences(
    filters?: PreferenceFilters, pagination?: PaginationOptions,
  ): Promise<ListResult<PreferenceRecord>> {
    await this.ensureConfigured();
    const tags: Record<string, string> = {};
    if (filters?.domain !== undefined) { tags.domain = filters.domain; }
    if (filters?.collection !== undefined) { tags.collection = filters.collection; }

    const { status, records, cursor } = await this.typed.records.query('preference', {
      filter     : Object.keys(tags).length > 0 ? { tags } : undefined,
      dateSort   : DateSort.CreatedDescending,
      pagination,
      encryption : true,
    });

    if (status.code !== 200) {
      throw new Error(`listPreferences failed: ${status.code} ${status.detail}`);
    }

    const results: PreferenceRecord[] = [];
    for (const record of records) {
      const data = await record.data.json() as PreferenceData;
      const rTags = record.tags as TagRecord | undefined;
      results.push({
        id        : record.id,
        contextId : record.contextId,
        data,
        tags      : {
          domain     : rTags?.domain as string,
          collection : rTags?.collection as string | undefined,
        },
        dateCreated: record.dateCreated,
      });
    }

    return { records: results, cursor };
  }

  async deletePreference(recordId: string): Promise<void> {
    await this.ensureConfigured();
    const { status } = await this.typed.records.delete('preference', { recordId });

    if (status.code !== 202) {
      throw new Error(`deletePreference failed: ${status.code} ${status.detail}`);
    }
  }

  // -------------------------------------------------------------------------
  // Relationships
  // -------------------------------------------------------------------------

  async addRelationship(name: string, type: string, opts?: {
    notes? : string;
    collection? : string;
  }): Promise<RecordResult> {
    await this.ensureConfigured();
    const tags: Record<string, string> = { name, type };
    if (opts?.collection !== undefined) { tags.collection = opts.collection; }

    const { status, record } = await this.typed.records.create('relationship', {
      data       : { name, notes: opts?.notes },
      tags,
      encryption : true,
    });

    if (status.code !== 202) {
      throw new Error(`addRelationship failed: ${status.code} ${status.detail}`);
    }

    return { id: record.id, contextId: record.contextId, status };
  }

  async listRelationships(
    filters?: RelationshipFilters, pagination?: PaginationOptions,
  ): Promise<ListResult<RelationshipRecord>> {
    await this.ensureConfigured();
    const tags: Record<string, string> = {};
    if (filters?.name !== undefined) { tags.name = filters.name; }
    if (filters?.type !== undefined) { tags.type = filters.type; }
    if (filters?.collection !== undefined) { tags.collection = filters.collection; }

    const { status, records, cursor } = await this.typed.records.query('relationship', {
      filter     : Object.keys(tags).length > 0 ? { tags } : undefined,
      dateSort   : DateSort.CreatedDescending,
      pagination,
      encryption : true,
    });

    if (status.code !== 200) {
      throw new Error(`listRelationships failed: ${status.code} ${status.detail}`);
    }

    const results: RelationshipRecord[] = [];
    for (const record of records) {
      const data = await record.data.json() as RelationshipData;
      const rTags = record.tags as TagRecord | undefined;
      results.push({
        id        : record.id,
        contextId : record.contextId,
        data,
        tags      : {
          name       : rTags?.name as string,
          type       : rTags?.type as string,
          collection : rTags?.collection as string | undefined,
        },
        dateCreated: record.dateCreated,
      });
    }

    return { records: results, cursor };
  }

  async deleteRelationship(recordId: string): Promise<void> {
    await this.ensureConfigured();
    const { status } = await this.typed.records.delete('relationship', { recordId });

    if (status.code !== 202) {
      throw new Error(`deleteRelationship failed: ${status.code} ${status.detail}`);
    }
  }
}
