import { defineProtocol } from '@enbox/api';
import type { ProtocolDefinition } from '@enbox/dwn-sdk-js';

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

export type ActionLogData = {
  description? : string;
  details? : Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Schema map
// ---------------------------------------------------------------------------

type AuditSchemaMap = {
  actionLog : ActionLogData;
  agent : Record<string, never>;
};

// ---------------------------------------------------------------------------
// Protocol definition
// ---------------------------------------------------------------------------

const definition = {
  protocol  : 'https://enbox.org/protocols/memory-audit/v1',
  published : false,
  types     : {
    actionLog: {
      schema      : 'https://enbox.org/schemas/memory-audit/action-log',
      dataFormats : ['application/json'],
    },
    agent: {},
  },
  structure: {
    actionLog: {
      $immutable : true,
      $tags      : {
        $requiredTags       : ['agentDid', 'action', 'targetProtocol', 'targetRecordId', 'status'],
        $allowUndefinedTags : false,
        agentDid            : { type: 'string' },
        action              : { type: 'string' },
        targetProtocol      : { type: 'string' },
        targetRecordId      : { type: 'string' },
        status              : { type: 'string', enum: ['success', 'failed'] },
      },
      $actions: [
        { role: 'actionLog/agent', can: ['create', 'read'] },
        { who: 'author', of: 'actionLog', can: ['create', 'read'] },
      ],
      agent: {
        $role: true,
      },
    },
  },
} as const satisfies ProtocolDefinition;

export const AuditProtocol = defineProtocol<typeof definition, AuditSchemaMap>(
  definition,
  {} as AuditSchemaMap,
);
