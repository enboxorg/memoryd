import { defineProtocol } from '@enbox/api';
import type { ProtocolDefinition, ProtocolRuleSet } from '@enbox/dwn-sdk-js';

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

export type TaskData = {
  title: string;
  description?: string;
};

export type DependencyData = {
  description?: string;
};

export type StatusChangeData = {
  reason?: string;
};

export type NoteData = {
  content: string;
};

// ---------------------------------------------------------------------------
// Schema map
// ---------------------------------------------------------------------------

type TaskGraphSchemaMap = {
  task: TaskData;
  dependency: DependencyData;
  statusChange: StatusChangeData;
  note: NoteData;
  agent: Record<string, never>;
};

// ---------------------------------------------------------------------------
// Shared fragments (mutable arrays for ProtocolDefinition compat)
// ---------------------------------------------------------------------------

const statusEnum = ['open', 'in_progress', 'blocked', 'closed'];
const priorityEnum = ['p0', 'p1', 'p2', 'p3', 'p4'];
const taskTypeEnum = ['epic', 'feature', 'bug', 'task', 'chore'];
const depTypeEnum = ['blocks', 'relates_to', 'duplicates', 'supersedes'];

function taskTags(): ProtocolRuleSet['$tags'] {
  return {
    $requiredTags       : ['status', 'priority'],
    $allowUndefinedTags : false,
    status              : { type: 'string', enum: [...statusEnum] },
    priority            : { type: 'string', enum: [...priorityEnum] },
    type                : { type: 'string', enum: [...taskTypeEnum] },
    assignee            : { type: 'string' },
    collection          : { type: 'string' },
  };
}

function taskActions(): ProtocolRuleSet['$actions'] {
  return [
    { role: 'task/agent', can: ['create', 'read', 'update'] },
    { who: 'author', of: 'task', can: ['create', 'read', 'update', 'delete'] },
  ];
}

// ---------------------------------------------------------------------------
// Protocol definition
// ---------------------------------------------------------------------------

const definition = {
  protocol  : 'https://enbox.org/protocols/task-graph/v1',
  published : false,
  types     : {
    task: {
      schema             : 'https://enbox.org/schemas/task-graph/task',
      dataFormats        : ['application/json'],
      encryptionRequired : true,
    },
    dependency: {
      schema      : 'https://enbox.org/schemas/task-graph/dependency',
      dataFormats : ['application/json'],
    },
    statusChange: {
      schema      : 'https://enbox.org/schemas/task-graph/status-change',
      dataFormats : ['application/json'],
    },
    note: {
      schema      : 'https://enbox.org/schemas/task-graph/note',
      dataFormats : ['application/json'],
    },
    agent: {},
  },
  structure: {
    task: {
      $tags    : taskTags(),
      $actions : taskActions(),

      agent: {
        $role: true,
      },

      // 2nd-level subtask
      task: {
        $tags    : taskTags(),
        $actions : taskActions(),

        // 3rd-level subtask
        task: {
          $tags    : taskTags(),
          $actions : taskActions(),
        },
      },

      dependency: {
        $immutable : true,
        $tags      : {
          $requiredTags       : ['type', 'targetId'],
          $allowUndefinedTags : false,
          type                : { type: 'string', enum: [...depTypeEnum] },
          targetId            : { type: 'string' },
        },
        $actions: [
          { role: 'task/agent', can: ['create', 'read'] },
          { who: 'author', of: 'task', can: ['create', 'read'] },
        ],
      },

      statusChange: {
        $immutable : true,
        $tags      : {
          $requiredTags       : ['from', 'to'],
          $allowUndefinedTags : false,
          from                : { type: 'string', enum: [...statusEnum] },
          to                  : { type: 'string', enum: [...statusEnum] },
          reason              : { type: 'string' },
        },
        $actions: [
          { role: 'task/agent', can: ['create', 'read'] },
          { who: 'author', of: 'task', can: ['create', 'read'] },
        ],
      },

      note: {
        $tags: {
          $allowUndefinedTags: false,
        },
        $actions: [
          { role: 'task/agent', can: ['create', 'read'] },
          { who: 'author', of: 'task', can: ['create', 'read', 'update', 'delete'] },
        ],
      },
    },
  },
} as const satisfies ProtocolDefinition;

// ---------------------------------------------------------------------------
// Typed protocol export
// ---------------------------------------------------------------------------

export const TaskGraphProtocol = defineProtocol(
  definition,
  {} as TaskGraphSchemaMap,
);
