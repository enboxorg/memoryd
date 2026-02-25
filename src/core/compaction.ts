// ---------------------------------------------------------------------------
// CompactionEngine — memory compaction/decay for the memoryd memory store.
// Archives stale superseded facts, merges near-duplicates, and vacuums the
// sidecar database.
// ---------------------------------------------------------------------------

import type { Database } from 'bun:sqlite';

import type { MemoryStore } from './memory-store.js';
import type { SearchIndex } from '../sidecar/search.js';
import type { TaskStore } from './task-store.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for compaction operations. */
export type CompactionConfig = {
  /** Days before superseded facts are archived (default: 30). */
  ageThresholdDays : number;
  /** Cosine similarity threshold for merging duplicates (default: 0.95). */
  similarityThreshold : number;
  /** Maximum number of facts to retain (default: 10000). */
  maxFactCount : number;
};

/** Result of a compaction run. */
export type CompactionResult = {
  /** Count of superseded facts older than threshold that were archived. */
  archivedStale : number;
  /** Count of near-duplicate facts that were merged. */
  mergedDuplicates : number;
  /** Whether the sidecar database was vacuumed. */
  vacuumed : boolean;
};

/** Injected summarisation function — merges multiple fact contents into one. */
export type SummarizeFn = (facts: string[]) => Promise<string>;

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: CompactionConfig = {
  ageThresholdDays    : 30,
  similarityThreshold : 0.95,
  maxFactCount        : 10000,
};

// ---------------------------------------------------------------------------
// Internal row type for sqlite-vec distance queries
// ---------------------------------------------------------------------------

type EmbeddingRow = {
  record_id : string;
  content_preview : string;
  distance : number;
};

// ---------------------------------------------------------------------------
// CompactionEngine
// ---------------------------------------------------------------------------

export class CompactionEngine {
  private readonly memoryStore : MemoryStore;
  private readonly _taskStore : TaskStore;
  private readonly sidecarDb? : Database;
  private readonly searchIndex? : SearchIndex;
  private readonly summarize? : SummarizeFn;
  private readonly hasVectorSearch : boolean;

  constructor(
    memoryStore : MemoryStore,
    taskStore : TaskStore,
    opts?: {
      sidecarDb? : Database;
      searchIndex? : SearchIndex;
      summarize? : SummarizeFn;
      hasVectorSearch? : boolean;
    },
  ) {
    this.memoryStore = memoryStore;
    this._taskStore = taskStore;
    this.sidecarDb = opts?.sidecarDb;
    this.searchIndex = opts?.searchIndex;
    this.summarize = opts?.summarize;
    this.hasVectorSearch = opts?.hasVectorSearch ?? true;
  }

  // -------------------------------------------------------------------------
  // archiveStale — archive superseded facts older than threshold
  // -------------------------------------------------------------------------

  async archiveStale(config?: Partial<CompactionConfig>): Promise<number> {
    const { ageThresholdDays } = { ...DEFAULT_CONFIG, ...config };

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - ageThresholdDays);
    const cutoffIso = cutoff.toISOString();

    // Fetch all superseded facts
    const { records } = await this.memoryStore.listFacts({ status: 'superseded' });

    let archived = 0;
    for (const fact of records) {
      // Only archive facts older than the threshold
      if (fact.dateCreated < cutoffIso) {
        await this.memoryStore.updateFact(fact.id, { status: 'archived' });
        archived++;
      }
    }

    return archived;
  }

  // -------------------------------------------------------------------------
  // mergeRedundant — find near-duplicate facts via vector similarity
  // -------------------------------------------------------------------------

  async mergeRedundant(
    config?: Partial<CompactionConfig>,
    summarize?: SummarizeFn,
  ): Promise<number> {
    const effectiveSummarize = summarize ?? this.summarize;

    if (!this.sidecarDb || !this.hasVectorSearch) {
      return 0;
    }
    if (!effectiveSummarize) {
      return 0;
    }

    const { similarityThreshold } = { ...DEFAULT_CONFIG, ...config };

    // Query all active fact embeddings from the sidecar
    const rows = this.sidecarDb.prepare(`
      SELECT record_id, content_preview
      FROM memory_embeddings
    `).all() as Array<{ record_id: string; content_preview: string }>;

    if (rows.length < 2) {
      return 0;
    }

    // For each record, find near-duplicates via KNN and group them
    const merged = new Set<string>();
    let mergeCount = 0;

    for (const row of rows) {
      if (merged.has(row.record_id)) {
        continue;
      }

      // Get this record's embedding
      const embeddingRow = this.sidecarDb.prepare(`
        SELECT embedding FROM memory_embeddings WHERE record_id = ?
      `).get(row.record_id) as { embedding: Float32Array } | null;

      if (!embeddingRow) {
        continue;
      }

      // Find similar records using sqlite-vec KNN
      const similar = this.sidecarDb.prepare(`
        SELECT record_id, content_preview, distance
        FROM memory_embeddings
        WHERE embedding MATCH ?
          AND k = ?
      `).all(embeddingRow.embedding, rows.length) as EmbeddingRow[];

      // Cosine distance: 0 = identical, 2 = opposite.
      // Threshold is similarity (0.95), so distance threshold = 1 - similarity.
      const distanceThreshold = 1 - similarityThreshold;

      // Group candidates that are below distance threshold
      const group: Array<{ recordId: string; content: string }> = [];
      for (const s of similar) {
        if (s.record_id === row.record_id) {
          continue;
        }
        if (merged.has(s.record_id)) {
          continue;
        }
        if (s.distance <= distanceThreshold) {
          group.push({ recordId: s.record_id, content: s.content_preview });
        }
      }

      if (group.length === 0) {
        continue;
      }

      // Include the current record in the group
      group.unshift({ recordId: row.record_id, content: row.content_preview });

      // Summarize the group into a single fact
      const contents = group.map(g => g.content);
      const summary = await effectiveSummarize(contents);

      // Use supersedeFact on the first record as the base, then supersede the rest
      const baseId = group[0].recordId;
      const newResult = await this.memoryStore.supersedeFact(baseId, summary, {
        reason: 'Compaction: merged near-duplicate facts',
      });

      // Mark the remaining group members as superseded
      for (let i = 1; i < group.length; i++) {
        await this.memoryStore.supersedeFact(group[i].recordId, summary, {
          reason: 'Compaction: merged near-duplicate facts',
        });
        merged.add(group[i].recordId);
      }

      merged.add(baseId);

      // Update the search index if available
      if (this.searchIndex) {
        for (const g of group) {
          this.searchIndex.remove(g.recordId);
        }
        await this.searchIndex.upsert({
          recordId     : newResult.id,
          protocolPath : 'memory/v1/fact',
          content      : summary,
        });
      }

      mergeCount += group.length;
    }

    return mergeCount;
  }

  // -------------------------------------------------------------------------
  // vacuumSidecar — run VACUUM on the sidecar database
  // -------------------------------------------------------------------------

  vacuumSidecar(): boolean {
    if (!this.sidecarDb) {
      return false;
    }
    this.sidecarDb.exec('VACUUM');
    return true;
  }

  // -------------------------------------------------------------------------
  // compact — run all compaction operations in sequence
  // -------------------------------------------------------------------------

  async compact(
    config?: Partial<CompactionConfig>,
    summarize?: SummarizeFn,
  ): Promise<CompactionResult> {
    const archivedStale = await this.archiveStale(config);
    const mergedDuplicates = await this.mergeRedundant(config, summarize);
    const vacuumed = this.vacuumSidecar();

    return { archivedStale, mergedDuplicates, vacuumed };
  }
}
