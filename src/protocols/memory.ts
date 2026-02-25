import { defineProtocol } from '@enbox/api';
import type { ProtocolDefinition } from '@enbox/dwn-sdk-js';

// ---------------------------------------------------------------------------
// Data types — mirror the JSON schemas in schemas/
// ---------------------------------------------------------------------------

export type FactData = {
  content : string;
  context?: string;
};

export type PreferenceData = {
  content : string;
  context?: string;
};

export type RelationshipData = {
  name : string;
  notes?: string;
};

export type CollectionData = {
  description?: string;
};

export type SupersessionData = {
  reason?: string;
};

// ---------------------------------------------------------------------------
// Schema map — associates TS types with protocol type names
// ---------------------------------------------------------------------------

type MemorySchemaMap = {
  fact : FactData;
  preference : PreferenceData;
  relationship : RelationshipData;
  collection : CollectionData;
  agent : Record<string, never>;
  supersession : SupersessionData;
};

// ---------------------------------------------------------------------------
// Protocol definition
// ---------------------------------------------------------------------------

const SCHEMA_BASE = 'https://enbox.org/schemas/memory';

const MemoryDefinition = {
  protocol  : 'https://enbox.org/protocols/memory/v1',
  published : false,
  types     : {
    fact: {
      schema             : `${SCHEMA_BASE}/fact`,
      dataFormats        : ['application/json'],
      encryptionRequired : true,
    },
    preference: {
      schema             : `${SCHEMA_BASE}/preference`,
      dataFormats        : ['application/json'],
      encryptionRequired : true,
    },
    relationship: {
      schema             : `${SCHEMA_BASE}/relationship`,
      dataFormats        : ['application/json'],
      encryptionRequired : true,
    },
    collection: {
      schema      : `${SCHEMA_BASE}/collection`,
      dataFormats : ['application/json'],
    },
    agent        : {},
    supersession : {
      schema      : `${SCHEMA_BASE}/supersession`,
      dataFormats : ['application/json'],
    },
  },
  structure: {
    fact: {
      agent : { $role: true },
      $tags : {
        $requiredTags       : ['category', 'source'],
        $allowUndefinedTags : false,
        category            : { type: 'string' },
        source              : { type: 'string' },
        confidence          : { type: 'number', minimum: 0, maximum: 1 },
        status              : { type: 'string', enum: ['active', 'superseded', 'archived'] },
        collection          : { type: 'string' },
      },
      $actions: [
        { role: 'fact/agent', can: ['create', 'read'] },
        { who: 'author', of: 'fact', can: ['create', 'read', 'update', 'delete'] },
      ],
      supersession: {
        $immutable : true,
        $tags      : {
          $requiredTags       : ['supersededBy'],
          $allowUndefinedTags : false,
          supersededBy        : { type: 'string' },
        },
        $actions: [
          { role: 'fact/agent', can: ['create', 'read'] },
          { who: 'author', of: 'fact', can: ['create', 'read'] },
        ],
      },
    },
    preference: {
      agent : { $role: true },
      $tags : {
        $requiredTags       : ['domain'],
        $allowUndefinedTags : false,
        domain              : { type: 'string' },
        collection          : { type: 'string' },
      },
      $actions: [
        { role: 'preference/agent', can: ['create', 'read'] },
        { who: 'author', of: 'preference', can: ['create', 'read', 'update', 'delete'] },
      ],
    },
    relationship: {
      agent : { $role: true },
      $tags : {
        $requiredTags       : ['name', 'type'],
        $allowUndefinedTags : false,
        name                : { type: 'string' },
        type                : { type: 'string', enum: ['person', 'org', 'project', 'tool'] },
        collection          : { type: 'string' },
      },
      $actions: [
        { role: 'relationship/agent', can: ['create', 'read'] },
        { who: 'author', of: 'relationship', can: ['create', 'read', 'update', 'delete'] },
      ],
    },
    collection: {
      $tags: {
        $requiredTags       : ['name'],
        $allowUndefinedTags : false,
        name                : { type: 'string' },
      },
      $actions: [
        { who: 'anyone', can: ['read'] },
        { who: 'author', of: 'collection', can: ['create', 'read', 'update', 'delete'] },
      ],
    },
  },
} as const satisfies ProtocolDefinition;

// ---------------------------------------------------------------------------
// Typed protocol export
// ---------------------------------------------------------------------------

export const MemoryProtocol = defineProtocol<typeof MemoryDefinition, MemorySchemaMap>(
  MemoryDefinition,
  {} as MemorySchemaMap,
);
