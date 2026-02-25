import { describe, expect, it } from 'bun:test';

import { MemoryProtocol } from '../../src/protocols/memory.js';

const def = MemoryProtocol.definition;

describe('MemoryProtocol', () => {
  // -----------------------------------------------------------------------
  // Top-level metadata
  // -----------------------------------------------------------------------

  it('has the correct protocol URI', () => {
    expect(def.protocol).toBe('https://enbox.org/protocols/memory/v1');
  });

  it('is not published', () => {
    expect(def.published).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Types
  // -----------------------------------------------------------------------

  it('declares all expected types', () => {
    const typeNames = Object.keys(def.types).sort();
    expect(typeNames).toEqual(
      ['agent', 'collection', 'fact', 'preference', 'relationship', 'supersession'],
    );
  });

  it('requires encryption for fact', () => {
    expect(def.types.fact.encryptionRequired).toBe(true);
  });

  it('requires encryption for preference', () => {
    expect(def.types.preference.encryptionRequired).toBe(true);
  });

  it('requires encryption for relationship', () => {
    expect(def.types.relationship.encryptionRequired).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Fact structure
  // -----------------------------------------------------------------------

  describe('fact structure', () => {
    const fact = def.structure.fact;

    it('has required tags: category, source', () => {
      expect(fact.$tags?.$requiredTags).toEqual(['category', 'source']);
    });

    it('has an agent role record', () => {
      expect((fact as Record<string, unknown>).agent).toEqual({ $role: true });
    });

    it('nests supersession under fact', () => {
      const supersession = (fact as Record<string, unknown>).supersession as Record<string, unknown>;
      expect(supersession).toBeDefined();
    });

    it('marks supersession as $immutable', () => {
      const supersession = (fact as Record<string, unknown>).supersession as Record<string, unknown>;
      expect(supersession.$immutable).toBe(true);
    });

    it('supersession has required tag: supersededBy', () => {
      const supersession = (fact as Record<string, unknown>).supersession as Record<string, unknown>;
      const tags = supersession.$tags as Record<string, unknown>;
      expect(tags.$requiredTags).toEqual(['supersededBy']);
    });
  });

  // -----------------------------------------------------------------------
  // Preference structure
  // -----------------------------------------------------------------------

  describe('preference structure', () => {
    const preference = def.structure.preference;

    it('has required tags: domain', () => {
      expect(preference.$tags?.$requiredTags).toEqual(['domain']);
    });

    it('has an agent role record', () => {
      expect((preference as Record<string, unknown>).agent).toEqual({ $role: true });
    });
  });

  // -----------------------------------------------------------------------
  // Relationship structure
  // -----------------------------------------------------------------------

  describe('relationship structure', () => {
    const relationship = def.structure.relationship;

    it('has required tags: name, type', () => {
      expect(relationship.$tags?.$requiredTags).toEqual(['name', 'type']);
    });

    it('has an agent role record', () => {
      expect((relationship as Record<string, unknown>).agent).toEqual({ $role: true });
    });
  });

  // -----------------------------------------------------------------------
  // Collection structure
  // -----------------------------------------------------------------------

  describe('collection structure', () => {
    const collection = def.structure.collection;

    it('has required tags: name', () => {
      expect(collection.$tags?.$requiredTags).toEqual(['name']);
    });
  });

  // -----------------------------------------------------------------------
  // Agent role records
  // -----------------------------------------------------------------------

  describe('agent role records', () => {
    it('fact/agent has $role: true', () => {
      const agent = (def.structure.fact as Record<string, unknown>).agent as Record<string, unknown>;
      expect(agent.$role).toBe(true);
    });

    it('preference/agent has $role: true', () => {
      const agent = (def.structure.preference as Record<string, unknown>).agent as Record<string, unknown>;
      expect(agent.$role).toBe(true);
    });

    it('relationship/agent has $role: true', () => {
      const agent = (def.structure.relationship as Record<string, unknown>).agent as Record<string, unknown>;
      expect(agent.$role).toBe(true);
    });
  });
});
