// memoryd MCP tools — memory_add_fact, memory_add_preference, memory_search,
// memory_supersede, memory_compact.

import type { CompactionEngine } from '../../core/compaction.js';
import type { MemorydServer } from '../server.js';
import type { MemoryStore } from '../../core/memory-store.js';
import type { SearchIndex } from '../../sidecar/search.js';

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Loose audit-typed interface — avoids importing protocol internals.
// ---------------------------------------------------------------------------

type AuditTyped = {
  records: {
    create: (type: string, opts: {
      data : Record<string, unknown>;
      tags : Record<string, string>;
    }) => Promise<unknown>;
  };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ToolContent = {
  content : { type: 'text'; text: string }[];
  isError? : boolean;
};

function jsonResult(data: unknown): ToolContent {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function errorResult(err: unknown): ToolContent {
  const message = err instanceof Error ? err.message : String(err);
  return { isError: true, content: [{ type: 'text', text: message }] };
}

async function writeAudit(
  auditTyped: AuditTyped | undefined,
  action: string,
  description: string,
  targetRecordId: string,
): Promise<void> {
  if (!auditTyped) { return; }
  await auditTyped.records.create('actionLog', {
    data : { description },
    tags : {
      agentDid       : 'self',
      action,
      targetProtocol : 'memory/v1',
      targetRecordId,
      status         : 'success',
    },
  });
}

// ---------------------------------------------------------------------------
// registerMemoryTools
// ---------------------------------------------------------------------------

export function registerMemoryTools(
  server: MemorydServer,
  memoryStore: MemoryStore,
  searchIndex?: SearchIndex,
  auditTyped?: AuditTyped,
  compactionEngine?: CompactionEngine,
): void {
  // -----------------------------------------------------------------------
  // memory_add_fact
  // -----------------------------------------------------------------------

  server.mcp.registerTool('memory_add_fact', {
    description : 'Add a new fact to the user\'s memory store.',
    inputSchema : {
      content    : z.string().describe('The fact content to store.'),
      category   : z.string().describe('Category for the fact (e.g. personal, work, health).'),
      source     : z.string().default('agent').describe('Source of the fact (e.g. user, agent).'),
      confidence : z.number().min(0).max(1).optional().describe('Confidence score between 0 and 1.'),
      collection : z.string().optional().describe('Optional collection to group the fact into.'),
    },
  }, async (args) => {
    try {
      const result = await memoryStore.addFact(args.content, args.category, args.source, {
        confidence : args.confidence,
        collection : args.collection,
      });
      await writeAudit(auditTyped, 'memory_add_fact', `Added fact: ${args.content.substring(0, 50)}`, result.id);
      return jsonResult(result);
    } catch (err) {
      return errorResult(err);
    }
  });

  // -----------------------------------------------------------------------
  // memory_add_preference
  // -----------------------------------------------------------------------

  server.mcp.registerTool('memory_add_preference', {
    description : 'Add a new preference to the user\'s memory store.',
    inputSchema : {
      content    : z.string().describe('The preference content to store.'),
      domain     : z.string().describe('Domain for the preference (e.g. ui, accessibility, communication).'),
      collection : z.string().optional().describe('Optional collection to group the preference into.'),
    },
  }, async (args) => {
    try {
      const result = await memoryStore.addPreference(args.content, args.domain, {
        collection: args.collection,
      });
      await writeAudit(auditTyped, 'memory_add_preference', `Added preference: ${args.content.substring(0, 50)}`, result.id);
      return jsonResult(result);
    } catch (err) {
      return errorResult(err);
    }
  });

  // -----------------------------------------------------------------------
  // memory_search
  // -----------------------------------------------------------------------

  server.mcp.registerTool('memory_search', {
    description : 'Search the user\'s memory store for facts and preferences.',
    inputSchema : {
      query      : z.string().optional().describe('Free-text search query. Uses hybrid vector+FTS if search index is available.'),
      category   : z.string().optional().describe('Filter by fact category.'),
      domain     : z.string().optional().describe('Filter by preference domain.'),
      collection : z.string().optional().describe('Filter by collection.'),
      limit      : z.number().int().min(1).max(100).default(10).describe('Maximum number of results to return.'),
    },
  }, async (args) => {
    try {
      // If a search index is available and a query is provided, use hybrid search.
      if (searchIndex && args.query) {
        const filters: Record<string, string> = {};
        if (args.category) { filters.category = args.category; }
        if (args.collection) { filters.collection = args.collection; }

        const results = await searchIndex.search(args.query, {
          limit   : args.limit,
          filters : Object.keys(filters).length > 0 ? filters : undefined,
        });

        await writeAudit(
          auditTyped, 'memory_search',
          `Searched: ${args.query.substring(0, 50)}`,
          `query:${args.query.substring(0, 30)}`,
        );
        return jsonResult(results);
      }

      // Fallback: list facts from the memory store with tag filters.
      const filters: Record<string, string> = {};
      if (args.category) { filters.category = args.category; }
      if (args.collection) { filters.collection = args.collection; }

      const listResult = await memoryStore.listFacts(
        Object.keys(filters).length > 0 ? filters : undefined,
        { limit: args.limit },
      );

      await writeAudit(
        auditTyped, 'memory_search',
        `Listed facts${args.category ? ` in category ${args.category}` : ''}`,
        'list',
      );
      return jsonResult(listResult.records);
    } catch (err) {
      return errorResult(err);
    }
  });

  // -----------------------------------------------------------------------
  // memory_supersede
  // -----------------------------------------------------------------------

  server.mcp.registerTool('memory_supersede', {
    description : 'Replace an existing fact with updated content, marking the old fact as superseded.',
    inputSchema : {
      oldFactId  : z.string().describe('The record ID of the fact to supersede.'),
      newContent : z.string().describe('The updated fact content.'),
      reason     : z.string().optional().describe('Reason for superseding the old fact.'),
    },
  }, async (args) => {
    try {
      const result = await memoryStore.supersedeFact(args.oldFactId, args.newContent, {
        reason: args.reason,
      });
      await writeAudit(
        auditTyped, 'memory_supersede',
        `Superseded fact ${args.oldFactId.substring(0, 20)}: ${args.newContent.substring(0, 30)}`,
        result.id,
      );
      return jsonResult(result);
    } catch (err) {
      return errorResult(err);
    }
  });

  // -----------------------------------------------------------------------
  // memory_compact
  // -----------------------------------------------------------------------

  server.mcp.registerTool('memory_compact', {
    description : 'Compact the memory store by archiving stale facts, merging near-duplicates, and vacuuming the sidecar.',
    inputSchema : {
      ageThresholdDays    : z.number().int().min(0).default(30).describe('Archive superseded facts older than this many days.'),
      similarityThreshold : z.number().min(0).max(1).default(0.95).describe('Cosine similarity threshold for merging duplicates.'),
    },
  }, async (args) => {
    try {
      if (!compactionEngine) {
        return jsonResult({ status: 'not_configured', message: 'Compaction engine not configured.' });
      }
      const result = await compactionEngine.compact({
        ageThresholdDays    : args.ageThresholdDays,
        similarityThreshold : args.similarityThreshold,
      });
      await writeAudit(
        auditTyped, 'memory_compact',
        `Compacted: archived=${result.archivedStale} merged=${result.mergedDuplicates} vacuumed=${result.vacuumed}`,
        'compaction',
      );
      return jsonResult(result);
    } catch (err) {
      return errorResult(err);
    }
  });
}
