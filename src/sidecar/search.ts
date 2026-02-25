// ---------------------------------------------------------------------------
// SearchIndex — Hybrid search with RRF (Reciprocal Rank Fusion).
// Combines sqlite-vec KNN vector search with FTS5 BM25 full-text search.
// ---------------------------------------------------------------------------

import type { Database } from 'bun:sqlite';

import type { EmbeddingProvider } from './embeddings.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SearchResult = {
  recordId: string;
  protocolPath: string;
  content: string;
  category?: string;
  collection?: string;
  score: number;
};

export type SearchFilters = {
  protocolPath?: string;
  category?: string;
  collection?: string;
};

export type IndexRecord = {
  recordId: string;
  protocolPath: string;
  content: string;
  category?: string;
  collection?: string;
};

// ---------------------------------------------------------------------------
// SearchIndex
// ---------------------------------------------------------------------------

export class SearchIndex {
  constructor(
    private readonly db: Database,
    private readonly embeddings: EmbeddingProvider,
  ) {}

  /** Upsert a record into both vector and FTS indexes. */
  async upsert(record: IndexRecord): Promise<void> {
    const embedding = await this.embeddings.embed(record.content);
    const now = new Date().toISOString();

    // Delete existing entries for this record_id (if updating)
    this.db.prepare('DELETE FROM memory_embeddings WHERE record_id = ?').run(record.recordId);
    this.db.prepare('DELETE FROM memory_fts WHERE record_id = ?').run(record.recordId);

    // Insert into vec0
    this.db.prepare(`
      INSERT INTO memory_embeddings(embedding, record_id, protocol_path, content_preview, category, collection, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      new Float32Array(embedding),
      record.recordId,
      record.protocolPath,
      record.content.substring(0, 200),
      record.category ?? null,
      record.collection ?? null,
      now,
    );

    // Insert into FTS5
    this.db.prepare(`
      INSERT INTO memory_fts(content, record_id, protocol_path, category, collection)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      record.content,
      record.recordId,
      record.protocolPath,
      record.category ?? null,
      record.collection ?? null,
    );
  }

  /** Remove a record from both indexes. */
  remove(recordId: string): void {
    this.db.prepare('DELETE FROM memory_embeddings WHERE record_id = ?').run(recordId);
    this.db.prepare('DELETE FROM memory_fts WHERE record_id = ?').run(recordId);
  }

  /** Hybrid search: vector KNN + FTS5 BM25, merged with reciprocal rank fusion. */
  async search(query: string, opts?: {
    limit?: number;
    filters?: SearchFilters;
  }): Promise<SearchResult[]> {
    const limit = opts?.limit ?? 10;
    const k = 60; // RRF constant

    // 1. Vector KNN search
    const queryEmbedding = await this.embeddings.embed(query);
    const vectorResults = this.vectorSearch(new Float32Array(queryEmbedding), limit * 2, opts?.filters);

    // 2. FTS5 search
    const ftsResults = this.ftsSearch(query, limit * 2, opts?.filters);

    // 3. Reciprocal Rank Fusion
    const merged = this.reciprocalRankFusion(vectorResults, ftsResults, k);

    return merged.slice(0, limit);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private vectorSearch(embedding: Float32Array, limit: number, filters?: SearchFilters): RankedResult[] {
    // sqlite-vec KNN query
    // vec0 metadata filtering isn't fully flexible, so we fetch more and post-filter.
    const rows = this.db.prepare(`
      SELECT record_id, protocol_path, content_preview, category, collection, distance
      FROM memory_embeddings
      WHERE embedding MATCH ?
        AND k = ?
    `).all(embedding, limit * 2) as VecRow[];

    let filtered = rows;
    if (filters?.protocolPath) {
      filtered = filtered.filter(r => r.protocol_path === filters.protocolPath);
    }
    if (filters?.category) {
      filtered = filtered.filter(r => r.category === filters.category);
    }
    if (filters?.collection) {
      filtered = filtered.filter(r => r.collection === filters.collection);
    }

    return filtered.slice(0, limit).map((r, i) => ({
      recordId     : r.record_id,
      protocolPath : r.protocol_path,
      content      : r.content_preview,
      category     : r.category ?? undefined,
      collection   : r.collection ?? undefined,
      rank         : i + 1,
    }));
  }

  private ftsSearch(query: string, limit: number, filters?: SearchFilters): RankedResult[] {
    // Escape FTS5 special characters and build query
    const ftsQuery = query.replace(/['"]/g, '').trim();
    if (!ftsQuery) { return []; }

    // Build WHERE clause for filters
    let filterClauses = '';
    const params: (string | number)[] = [ftsQuery, limit];
    if (filters?.protocolPath) {
      filterClauses += ' AND protocol_path = ?';
      params.push(filters.protocolPath);
    }
    if (filters?.category) {
      filterClauses += ' AND category = ?';
      params.push(filters.category);
    }
    if (filters?.collection) {
      filterClauses += ' AND collection = ?';
      params.push(filters.collection);
    }

    try {
      const rows = this.db.prepare(`
        SELECT record_id, protocol_path, content, category, collection, rank
        FROM memory_fts
        WHERE memory_fts MATCH ?${filterClauses}
        ORDER BY rank
        LIMIT ?
      `).all(...params) as FtsRow[];

      return rows.map((r, i) => ({
        recordId     : r.record_id,
        protocolPath : r.protocol_path,
        content      : r.content,
        category     : r.category ?? undefined,
        collection   : r.collection ?? undefined,
        rank         : i + 1,
      }));
    } catch {
      // FTS5 can throw on malformed queries; return empty.
      return [];
    }
  }

  private reciprocalRankFusion(
    vectorResults: RankedResult[],
    ftsResults: RankedResult[],
    k: number,
  ): SearchResult[] {
    const scores = new Map<string, { result: Omit<SearchResult, 'score'>; score: number }>();

    for (const r of vectorResults) {
      const existing = scores.get(r.recordId);
      const rrfScore = 1 / (k + r.rank);
      if (existing) {
        existing.score += rrfScore;
      } else {
        scores.set(r.recordId, {
          result: {
            recordId     : r.recordId,
            protocolPath : r.protocolPath,
            content      : r.content,
            category     : r.category,
            collection   : r.collection,
          },
          score: rrfScore,
        });
      }
    }

    for (const r of ftsResults) {
      const existing = scores.get(r.recordId);
      const rrfScore = 1 / (k + r.rank);
      if (existing) {
        existing.score += rrfScore;
      } else {
        scores.set(r.recordId, {
          result: {
            recordId     : r.recordId,
            protocolPath : r.protocolPath,
            content      : r.content,
            category     : r.category,
            collection   : r.collection,
          },
          score: rrfScore,
        });
      }
    }

    return Array.from(scores.values())
      .sort((a, b) => b.score - a.score)
      .map(({ result, score }) => ({ ...result, score }));
  }
}

// ---------------------------------------------------------------------------
// Internal row types
// ---------------------------------------------------------------------------

type VecRow = {
  record_id: string;
  protocol_path: string;
  content_preview: string;
  category: string | null;
  collection: string | null;
  distance: number;
};

type FtsRow = {
  record_id: string;
  protocol_path: string;
  content: string;
  category: string | null;
  collection: string | null;
  rank: number;
};

type RankedResult = {
  recordId: string;
  protocolPath: string;
  content: string;
  category?: string;
  collection?: string;
  rank: number;
};
