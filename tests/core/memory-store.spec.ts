import { rmSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { Web5 } from '@enbox/api';
import { Web5UserAgent } from '@enbox/agent';

import { MemoryProtocol } from '../../src/protocols/memory.js';
import { MemoryStore } from '../../src/core/memory-store.js';

const DATA_PATH = '__TESTDATA__/memory-store';

describe('MemoryStore', () => {
  let store: MemoryStore;
  let web5: Web5;

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

    // Configure protocol with encryption
    const typed = web5.using(MemoryProtocol);
    await typed.configure({ encryption: true });

    store = new MemoryStore(web5);
  }, 30_000);

  afterAll(() => {
    rmSync(DATA_PATH, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Facts
  // -------------------------------------------------------------------------

  describe('facts', () => {
    it('addFact creates a fact and returns RecordResult with id', async () => {
      const result = await store.addFact('User likes cats', 'personal', 'user');
      expect(result.id).toBeDefined();
      expect(typeof result.id).toBe('string');
      expect(result.status.code).toBe(202);
    });

    it('getFact retrieves a fact by ID with correct data and tags', async () => {
      const created = await store.addFact('User likes dogs', 'personal', 'user', {
        confidence: 0.9,
      });
      const fact = await store.getFact(created.id);
      expect(fact.id).toBe(created.id);
      expect(fact.data.content).toBe('User likes dogs');
      expect(fact.tags.category).toBe('personal');
      expect(fact.tags.source).toBe('user');
      expect(fact.tags.confidence).toBe(0.9);
      expect(fact.tags.status).toBe('active');
      expect(fact.dateCreated).toBeDefined();
    });

    it('listFacts returns all facts', async () => {
      const { records } = await store.listFacts();
      expect(records.length).toBeGreaterThanOrEqual(2);
    });

    it('listFacts filters by category', async () => {
      await store.addFact('Work meeting at 9', 'work', 'agent');
      const { records } = await store.listFacts({ category: 'work' });
      expect(records.length).toBeGreaterThanOrEqual(1);
      for (const r of records) {
        expect(r.tags.category).toBe('work');
      }
    });

    it('listFacts supports pagination', async () => {
      // Create 5 facts with a unique category for isolation
      for (let i = 0; i < 5; i++) {
        await store.addFact(`Paginated fact ${i}`, 'pagination-test', 'user');
      }

      const page1 = await store.listFacts(
        { category: 'pagination-test' },
        { limit: 2 },
      );
      expect(page1.records.length).toBe(2);
      expect(page1.cursor).toBeDefined();

      const page2 = await store.listFacts(
        { category: 'pagination-test' },
        { limit: 2, cursor: page1.cursor },
      );
      expect(page2.records.length).toBe(2);
      expect(page2.cursor).toBeDefined();

      const page3 = await store.listFacts(
        { category: 'pagination-test' },
        { limit: 2, cursor: page2.cursor },
      );
      expect(page3.records.length).toBe(1);
    });

    it('updateFact updates content', async () => {
      const created = await store.addFact('Original content', 'personal', 'user');
      const updated = await store.updateFact(created.id, {
        content: 'Updated content',
      });
      expect(updated.status.code).toBe(202);

      const fact = await store.getFact(created.id);
      expect(fact.data.content).toBe('Updated content');
      expect(fact.tags.category).toBe('personal');
    });

    it('supersedeFact creates new fact and marks old as superseded', async () => {
      const old = await store.addFact('Old fact', 'personal', 'user');
      const result = await store.supersedeFact(old.id, 'New fact', {
        reason: 'Updated info',
      });

      expect(result.id).toBeDefined();
      expect(result.id).not.toBe(old.id);
      expect(result.status.code).toBe(202);

      // New fact should be active
      const newFact = await store.getFact(result.id);
      expect(newFact.data.content).toBe('New fact');
      expect(newFact.tags.status).toBe('active');

      // Old fact should be superseded
      const oldFact = await store.getFact(old.id);
      expect(oldFact.tags.status).toBe('superseded');
    });

    it('supersedeFact inherits category/source from old fact', async () => {
      const old = await store.addFact('Original', 'health', 'agent');
      const result = await store.supersedeFact(old.id, 'Replacement');

      const newFact = await store.getFact(result.id);
      expect(newFact.tags.category).toBe('health');
      expect(newFact.tags.source).toBe('agent');
    });

    it('deleteFact deletes a fact', async () => {
      const created = await store.addFact('To be deleted', 'personal', 'user');
      await store.deleteFact(created.id);

      try {
        await store.getFact(created.id);
        // If we get here, the read succeeded — unexpected
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeDefined();
      }
    });
  });

  // -------------------------------------------------------------------------
  // Preferences
  // -------------------------------------------------------------------------

  describe('preferences', () => {
    it('addPreference creates a preference', async () => {
      const result = await store.addPreference('Dark mode preferred', 'ui');
      expect(result.id).toBeDefined();
      expect(result.status.code).toBe(202);
    });

    it('listPreferences returns preferences filtered by domain', async () => {
      await store.addPreference('Large font', 'accessibility');
      const { records } = await store.listPreferences({ domain: 'accessibility' });
      expect(records.length).toBeGreaterThanOrEqual(1);
      for (const r of records) {
        expect(r.tags.domain).toBe('accessibility');
      }
    });

    it('deletePreference deletes a preference', async () => {
      const created = await store.addPreference('To delete', 'temp');
      await store.deletePreference(created.id);

      // Verify it's gone by listing with a unique domain
      const { records } = await store.listPreferences({ domain: 'temp' });
      const found = records.find(r => r.id === created.id);
      expect(found).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Relationships
  // -------------------------------------------------------------------------

  describe('relationships', () => {
    it('addRelationship creates a relationship', async () => {
      const result = await store.addRelationship('Alice', 'person', {
        notes: 'Close friend',
      });
      expect(result.id).toBeDefined();
      expect(result.status.code).toBe(202);
    });

    it('listRelationships filters by type', async () => {
      await store.addRelationship('Acme Corp', 'org');
      const { records } = await store.listRelationships({ type: 'org' });
      expect(records.length).toBeGreaterThanOrEqual(1);
      for (const r of records) {
        expect(r.tags.type).toBe('org');
      }
    });

    it('deleteRelationship deletes a relationship', async () => {
      const created = await store.addRelationship('Bob', 'person');
      await store.deleteRelationship(created.id);

      const { records } = await store.listRelationships({ name: 'Bob' });
      const found = records.find(r => r.id === created.id);
      expect(found).toBeUndefined();
    });
  });
});
