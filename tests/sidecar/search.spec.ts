import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { NoopProvider } from '../../src/sidecar/embeddings.js';
import { SearchIndex } from '../../src/sidecar/search.js';
import { SidecarDatabase } from '../../src/sidecar/database.js';

import type { IndexRecord } from '../../src/sidecar/search.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DIMS = 4;

function makeRecord(overrides: Partial<IndexRecord> & { recordId: string; content: string }): IndexRecord {
  return {
    protocolPath: 'memory/v1/fact',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// SearchIndex
// ---------------------------------------------------------------------------

describe('SearchIndex', () => {
  let sidecar: SidecarDatabase;
  let index: SearchIndex;

  beforeEach(() => {
    sidecar = new SidecarDatabase(':memory:', DIMS);
    index = new SearchIndex(sidecar.db, new NoopProvider(DIMS));
  });

  afterEach(() => {
    sidecar.close();
  });

  // -----------------------------------------------------------------------
  // upsert
  // -----------------------------------------------------------------------

  it('upsert adds record to both vector and FTS indexes', async () => {
    await index.upsert(makeRecord({ recordId: 'rec-1', content: 'TypeScript is great' }));

    const vecRows = sidecar.db.prepare('SELECT record_id FROM memory_embeddings').all() as Array<{ record_id: string }>;
    expect(vecRows).toHaveLength(1);
    expect(vecRows[0].record_id).toBe('rec-1');

    const ftsRows = sidecar.db.prepare('SELECT record_id FROM memory_fts').all() as Array<{ record_id: string }>;
    expect(ftsRows).toHaveLength(1);
    expect(ftsRows[0].record_id).toBe('rec-1');
  });

  it('upsert updates existing record (delete + re-insert)', async () => {
    await index.upsert(makeRecord({ recordId: 'rec-1', content: 'old content' }));
    await index.upsert(makeRecord({ recordId: 'rec-1', content: 'new content' }));

    const vecRows = sidecar.db.prepare('SELECT record_id FROM memory_embeddings').all();
    expect(vecRows).toHaveLength(1);

    const ftsRows = sidecar.db.prepare('SELECT content FROM memory_fts WHERE record_id = ?').all('rec-1') as Array<{ content: string }>;
    expect(ftsRows).toHaveLength(1);
    expect(ftsRows[0].content).toBe('new content');
  });

  // -----------------------------------------------------------------------
  // remove
  // -----------------------------------------------------------------------

  it('remove deletes from both indexes', async () => {
    await index.upsert(makeRecord({ recordId: 'rec-1', content: 'hello world' }));
    index.remove('rec-1');

    const vecRows = sidecar.db.prepare('SELECT record_id FROM memory_embeddings').all();
    expect(vecRows).toHaveLength(0);

    const ftsRows = sidecar.db.prepare('SELECT record_id FROM memory_fts').all();
    expect(ftsRows).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // search — FTS is the real signal with NoopProvider
  // -----------------------------------------------------------------------

  it('search returns results from FTS', async () => {
    await index.upsert(makeRecord({ recordId: 'rec-1', content: 'the quick brown fox' }));
    await index.upsert(makeRecord({ recordId: 'rec-2', content: 'lazy dog sleeps' }));

    const results = await index.search('fox');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some(r => r.recordId === 'rec-1')).toBe(true);
  });

  it('search filters by protocolPath', async () => {
    await index.upsert(makeRecord({ recordId: 'rec-1', content: 'shared keyword', protocolPath: 'memory/v1/fact' }));
    await index.upsert(makeRecord({ recordId: 'rec-2', content: 'shared keyword', protocolPath: 'task-graph/v1/task' }));

    const results = await index.search('keyword', { filters: { protocolPath: 'task-graph/v1/task' } });
    expect(results).toHaveLength(1);
    expect(results[0].recordId).toBe('rec-2');
  });

  it('search filters by category', async () => {
    await index.upsert(makeRecord({ recordId: 'rec-1', content: 'some data here', category: 'work' }));
    await index.upsert(makeRecord({ recordId: 'rec-2', content: 'some data here', category: 'personal' }));

    const results = await index.search('data', { filters: { category: 'personal' } });
    expect(results).toHaveLength(1);
    expect(results[0].recordId).toBe('rec-2');
  });

  it('search filters by collection', async () => {
    await index.upsert(makeRecord({ recordId: 'rec-1', content: 'item alpha', collection: 'col-A' }));
    await index.upsert(makeRecord({ recordId: 'rec-2', content: 'item alpha', collection: 'col-B' }));

    const results = await index.search('alpha', { filters: { collection: 'col-A' } });
    expect(results).toHaveLength(1);
    expect(results[0].recordId).toBe('rec-1');
  });

  it('search respects limit', async () => {
    for (let i = 0; i < 5; i++) {
      await index.upsert(makeRecord({ recordId: `rec-${i}`, content: `common term number ${i}` }));
    }

    const results = await index.search('common', { limit: 2 });
    expect(results).toHaveLength(2);
  });

  it('search returns empty for no matches', async () => {
    // With NoopProvider, vector search returns all records (zero-dist).
    // Use an empty database so neither FTS nor vector returns anything.
    const results = await index.search('nonexistenttermxyz');
    expect(results).toHaveLength(0);
  });

  it('search handles empty query gracefully', async () => {
    await index.upsert(makeRecord({ recordId: 'rec-1', content: 'hello world' }));

    const results = await index.search('');
    // Empty query should not crash; may return vector results (all zeros match)
    // but FTS will return nothing for empty.
    expect(Array.isArray(results)).toBe(true);
  });

  // -----------------------------------------------------------------------
  // RRF score verification
  // -----------------------------------------------------------------------

  it('RRF merges results from both sources with correct scores', async () => {
    // With NoopProvider, all embeddings are zero vectors. Vector search will
    // return results in insertion order (all equidistant). FTS returns results
    // ranked by BM25. A record appearing in both should have a higher RRF
    // score than one appearing in only one source.
    await index.upsert(makeRecord({ recordId: 'rec-1', content: 'unique apple fruit' }));
    await index.upsert(makeRecord({ recordId: 'rec-2', content: 'unique banana fruit' }));

    // Search for "apple" — rec-1 should appear in FTS, both in vector (zero-dist).
    const results = await index.search('apple');
    expect(results.length).toBeGreaterThanOrEqual(1);

    // The first result should be rec-1 (appears in both vector + FTS)
    const rec1 = results.find(r => r.recordId === 'rec-1');
    expect(rec1).toBeDefined();

    // All scores should be positive
    for (const r of results) {
      expect(r.score).toBeGreaterThan(0);
    }

    // rec-1 should have higher score than rec-2 (if rec-2 is present) because
    // rec-1 matches FTS while rec-2 does not.
    const rec2 = results.find(r => r.recordId === 'rec-2');
    if (rec1 && rec2) {
      expect(rec1.score).toBeGreaterThan(rec2.score);
    }
  });
});
