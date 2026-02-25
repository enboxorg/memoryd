import { rmSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { Web5 } from '@enbox/api';
import { Web5UserAgent } from '@enbox/agent';

import { CompactionEngine } from '../../src/core/compaction.js';
import { MemoryProtocol } from '../../src/protocols/memory.js';
import { MemoryStore } from '../../src/core/memory-store.js';
import { SearchIndex } from '../../src/sidecar/search.js';
import { SidecarDatabase } from '../../src/sidecar/database.js';
import { TaskGraphProtocol } from '../../src/protocols/task-graph.js';
import { TaskStore } from '../../src/core/task-store.js';

import type { EmbeddingProvider } from '../../src/sidecar/embeddings.js';
import type { SummarizeFn } from '../../src/core/compaction.js';

const DATA_PATH = '__TESTDATA__/compaction';
const DIMS = 4;

// ---------------------------------------------------------------------------
// Test embedding provider — returns predictable non-zero vectors
// ---------------------------------------------------------------------------

class TestEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = DIMS;
  private vectorMap = new Map<string, number[]>();

  /** Register a known vector for specific content. */
  setVector(content: string, vector: number[]): void {
    this.vectorMap.set(content, vector);
  }

  async embed(text: string): Promise<number[]> {
    const known = this.vectorMap.get(text);
    if (known) {
      return known;
    }
    // Default: hash-based deterministic vector
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    }
    return [
      Math.sin(hash) * 0.5 + 0.5,
      Math.cos(hash) * 0.5 + 0.5,
      Math.sin(hash * 2) * 0.5 + 0.5,
      Math.cos(hash * 2) * 0.5 + 0.5,
    ];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map(t => this.embed(t)));
  }
}

// ---------------------------------------------------------------------------
// CompactionEngine tests
// ---------------------------------------------------------------------------

describe('CompactionEngine', () => {
  let memoryStore: MemoryStore;
  let taskStore: TaskStore;

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
    const { web5 } = await Web5.connect({
      agent,
      connectedDid : identity.did.uri,
      sync         : 'off',
    });

    // Configure protocols
    const memoryTyped = web5.using(MemoryProtocol);
    await memoryTyped.configure({ encryption: true });

    const taskTyped = web5.using(TaskGraphProtocol);
    await taskTyped.configure({ encryption: true });

    memoryStore = new MemoryStore(web5);
    taskStore = new TaskStore(web5);
  }, 30_000);

  afterAll(() => {
    rmSync(DATA_PATH, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // archiveStale
  // -------------------------------------------------------------------------

  describe('archiveStale', () => {
    it('returns 0 when no superseded facts exist', async () => {
      const engine = new CompactionEngine(memoryStore, taskStore);
      const count = await engine.archiveStale({ ageThresholdDays: 0 });
      expect(count).toBe(0);
    });

    it('archives a superseded fact when threshold is 0 days', async () => {
      // Create a fact and supersede it
      const original = await memoryStore.addFact(
        'Stale fact to archive', 'compaction-test', 'user',
      );
      await memoryStore.supersedeFact(original.id, 'Replacement fact');

      const engine = new CompactionEngine(memoryStore, taskStore);
      const count = await engine.archiveStale({ ageThresholdDays: 0 });
      expect(count).toBeGreaterThanOrEqual(1);

      // Verify the fact was actually archived
      const fact = await memoryStore.getFact(original.id);
      expect(fact.tags.status).toBe('archived');
    });

    it('respects age threshold — recent superseded facts are not archived', async () => {
      // Create and supersede a fact (it will be very recent)
      const original = await memoryStore.addFact(
        'Recent superseded fact', 'compaction-age-test', 'user',
      );
      await memoryStore.supersedeFact(original.id, 'Replacement');

      const engine = new CompactionEngine(memoryStore, taskStore);
      // Use a large threshold — the fact was just created, so it's newer than 365 days
      const count = await engine.archiveStale({ ageThresholdDays: 365 });
      expect(count).toBe(0);

      // Verify the fact is still superseded, not archived
      const fact = await memoryStore.getFact(original.id);
      expect(fact.tags.status).toBe('superseded');
    });
  });

  // -------------------------------------------------------------------------
  // mergeRedundant
  // -------------------------------------------------------------------------

  describe('mergeRedundant', () => {
    it('returns 0 without sidecar', async () => {
      const engine = new CompactionEngine(memoryStore, taskStore);
      const mockSummarize: SummarizeFn = async (facts) => facts.join('; ');
      const count = await engine.mergeRedundant({}, mockSummarize);
      expect(count).toBe(0);
    });

    it('returns 0 without summarize function', async () => {
      const sidecar = new SidecarDatabase(':memory:', DIMS);
      try {
        const engine = new CompactionEngine(memoryStore, taskStore, {
          sidecarDb: sidecar.db,
        });
        const count = await engine.mergeRedundant();
        expect(count).toBe(0);
      } finally {
        sidecar.close();
      }
    });

    it('merges near-duplicate facts when sidecar and summarize are provided', async () => {
      const embeddings = new TestEmbeddingProvider();
      const sidecar = new SidecarDatabase(':memory:', DIMS);

      try {
        const searchIndex = new SearchIndex(sidecar.db, embeddings);

        // Create two facts with similar content
        const fact1 = await memoryStore.addFact(
          'The user likes TypeScript', 'merge-test', 'user',
        );
        const fact2 = await memoryStore.addFact(
          'User enjoys TypeScript programming', 'merge-test', 'user',
        );

        // Set identical vectors so they appear as near-duplicates
        const sameVector = [0.5, 0.5, 0.5, 0.5];
        embeddings.setVector('The user likes TypeScript', sameVector);
        embeddings.setVector('User enjoys TypeScript programming', sameVector);

        // Index both facts in the sidecar
        await searchIndex.upsert({
          recordId     : fact1.id,
          protocolPath : 'memory/v1/fact',
          content      : 'The user likes TypeScript',
          category     : 'merge-test',
        });
        await searchIndex.upsert({
          recordId     : fact2.id,
          protocolPath : 'memory/v1/fact',
          content      : 'User enjoys TypeScript programming',
          category     : 'merge-test',
        });

        let summarizeCalled = false;
        const mockSummarize: SummarizeFn = async (facts) => {
          summarizeCalled = true;
          return `Merged: ${facts.join(' + ')}`;
        };

        const engine = new CompactionEngine(memoryStore, taskStore, {
          sidecarDb : sidecar.db,
          searchIndex,
          summarize : mockSummarize,
        });

        const count = await engine.mergeRedundant({ similarityThreshold: 0.95 });
        expect(count).toBeGreaterThanOrEqual(2);
        expect(summarizeCalled).toBe(true);

        // Verify original facts are now superseded
        const f1 = await memoryStore.getFact(fact1.id);
        expect(f1.tags.status).toBe('superseded');
        const f2 = await memoryStore.getFact(fact2.id);
        expect(f2.tags.status).toBe('superseded');
      } finally {
        sidecar.close();
      }
    });
  });

  // -------------------------------------------------------------------------
  // vacuumSidecar
  // -------------------------------------------------------------------------

  describe('vacuumSidecar', () => {
    it('returns false without sidecar', () => {
      const engine = new CompactionEngine(memoryStore, taskStore);
      expect(engine.vacuumSidecar()).toBe(false);
    });

    it('returns true when sidecar is available', () => {
      const sidecar = new SidecarDatabase(':memory:', DIMS);
      try {
        const engine = new CompactionEngine(memoryStore, taskStore, {
          sidecarDb: sidecar.db,
        });
        expect(engine.vacuumSidecar()).toBe(true);
      } finally {
        sidecar.close();
      }
    });
  });

  // -------------------------------------------------------------------------
  // compact
  // -------------------------------------------------------------------------

  describe('compact', () => {
    it('returns combined result from all operations', async () => {
      const engine = new CompactionEngine(memoryStore, taskStore);
      const result = await engine.compact();

      expect(typeof result.archivedStale).toBe('number');
      expect(typeof result.mergedDuplicates).toBe('number');
      expect(result.vacuumed).toBe(false); // no sidecar
    });

    it('compact with sidecar vacuums successfully', async () => {
      const sidecar = new SidecarDatabase(':memory:', DIMS);
      try {
        const engine = new CompactionEngine(memoryStore, taskStore, {
          sidecarDb: sidecar.db,
        });
        const result = await engine.compact();

        expect(result.vacuumed).toBe(true);
        expect(typeof result.archivedStale).toBe('number');
        expect(result.mergedDuplicates).toBe(0); // no summarize fn
      } finally {
        sidecar.close();
      }
    });
  });
});
