// MCP task tools — registers task-graph tools on the MCP server.

import { z } from 'zod';

import type { GraphEngine } from '../../core/graph.js';
import type { MemorydServer } from '../../mcp/server.js';
import type { TaskStore } from '../../core/task-store.js';

// ---------------------------------------------------------------------------
// Audit helper type
// ---------------------------------------------------------------------------

type AuditTyped = {
  records: {
    create: (
      type: 'actionLog',
      opts: {
        data: { description: string };
        tags: {
          agentDid: string;
          action: string;
          targetProtocol: string;
          targetRecordId: string;
          status: string;
        };
      },
    ) => Promise<unknown>;
  };
};

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

type ToolResponse = {
  content: { type: 'text'; text: string }[];
  isError?: true;
};

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function jsonContent(data: unknown): ToolResponse {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

function errorContent(message: string): ToolResponse {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

// ---------------------------------------------------------------------------
// Audit helper
// ---------------------------------------------------------------------------

async function writeAudit(
  auditTyped: AuditTyped | undefined,
  action: string,
  description: string,
  targetRecordId: string,
): Promise<void> {
  if (!auditTyped) {
    return;
  }

  await auditTyped.records.create('actionLog', {
    data : { description },
    tags : {
      agentDid       : 'self',
      action,
      targetProtocol : 'task-graph/v1',
      targetRecordId,
      status         : 'success',
    },
  });
}

// ---------------------------------------------------------------------------
// Register task tools
// ---------------------------------------------------------------------------

export function registerTaskTools(
  server: MemorydServer,
  taskStore: TaskStore,
  graphEngine: GraphEngine,
  auditTyped?: AuditTyped,
): void {
  // -------------------------------------------------------------------------
  // task_create
  // -------------------------------------------------------------------------

  server.mcp.registerTool(
    'task_create',
    {
      description : 'Create a new task or subtask in the task graph.',
      inputSchema : {
        title        : z.string().describe('Title of the task'),
        description  : z.string().optional().describe('Description of the task'),
        priority     : z.enum(['p0', 'p1', 'p2', 'p3']).describe('Priority level'),
        type         : z.string().optional().describe('Task type (e.g. feature, bug)'),
        parentTaskId : z.string().optional().describe('Parent task ID for creating a subtask'),
        collection   : z.string().optional().describe('Collection to group the task'),
      },
    },
    async ({ title, description, priority, type, parentTaskId, collection }): Promise<ToolResponse> => {
      try {
        if (parentTaskId) {
          const parent = await taskStore.getTask(parentTaskId);
          const result = await taskStore.createSubtask(parent.contextId!, title, priority, {
            description,
            type,
            collection,
          });

          await writeAudit(
            auditTyped,
            'task_create',
            `Created subtask: ${title.substring(0, 50)}`,
            result.id,
          );

          return jsonContent(result);
        }

        const result = await taskStore.createTask(title, priority, {
          description,
          type,
          collection,
        });

        await writeAudit(
          auditTyped,
          'task_create',
          `Created task: ${title.substring(0, 50)}`,
          result.id,
        );

        return jsonContent(result);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return errorContent(message);
      }
    },
  );

  // -------------------------------------------------------------------------
  // task_update
  // -------------------------------------------------------------------------

  server.mcp.registerTool(
    'task_update',
    {
      description : 'Update an existing task (status, priority, assignee) or claim it.',
      inputSchema : {
        taskId   : z.string().describe('ID of the task to update'),
        status   : z.string().optional().describe('New status'),
        priority : z.string().optional().describe('New priority'),
        assignee : z.string().optional().describe('Assignee DID or name'),
        claim    : z.boolean().optional().describe('If true, atomically claim the task'),
      },
    },
    async ({ taskId, status, priority, assignee, claim }): Promise<ToolResponse> => {
      try {
        if (claim) {
          const result = await taskStore.claimTask(taskId, assignee ?? 'agent');

          await writeAudit(
            auditTyped,
            'task_update',
            `Claimed task: ${taskId.substring(0, 50)}`,
            taskId,
          );

          return jsonContent(result);
        }

        const updates: Record<string, string> = {};
        if (status !== undefined) { updates.status = status; }
        if (priority !== undefined) { updates.priority = priority; }
        if (assignee !== undefined) { updates.assignee = assignee; }

        const result = await taskStore.updateTask(taskId, updates);

        await writeAudit(
          auditTyped,
          'task_update',
          `Updated task: ${taskId.substring(0, 50)}`,
          taskId,
        );

        return jsonContent(result);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return errorContent(message);
      }
    },
  );

  // -------------------------------------------------------------------------
  // task_add_dependency
  // -------------------------------------------------------------------------

  server.mcp.registerTool(
    'task_add_dependency',
    {
      description : 'Add a dependency between tasks (with cycle detection).',
      inputSchema : {
        taskId    : z.string().describe('ID of the task that will be blocked'),
        dependsOn : z.string().describe('ID of the blocking task'),
        type      : z.string().default('blocks').describe('Dependency type'),
      },
    },
    async ({ taskId, dependsOn, type }): Promise<ToolResponse> => {
      try {
        const cycle = await graphEngine.detectCycle(taskId, dependsOn);
        if (cycle) {
          return errorContent(`Cycle detected: ${cycle.join(' → ')}`);
        }

        const task = await taskStore.getTask(taskId);
        await taskStore.addDependency(task.contextId!, dependsOn, type);

        await writeAudit(
          auditTyped,
          'task_add_dependency',
          `Added dependency: ${taskId.substring(0, 20)} depends on ${dependsOn.substring(0, 20)}`,
          taskId,
        );

        return jsonContent({ success: true, taskId, dependsOn, type });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return errorContent(message);
      }
    },
  );

  // -------------------------------------------------------------------------
  // task_ready
  // -------------------------------------------------------------------------

  server.mcp.registerTool(
    'task_ready',
    {
      description : 'List tasks that are ready to work on (all blockers resolved).',
      inputSchema : {
        collection : z.string().optional().describe('Filter by collection'),
        priority   : z.string().optional().describe('Filter by priority'),
      },
    },
    async ({ collection, priority }): Promise<ToolResponse> => {
      try {
        const ready = await graphEngine.getReadyTasks({ collection, priority });

        await writeAudit(
          auditTyped,
          'task_ready',
          `Listed ${ready.length} ready tasks`,
          'query',
        );

        return jsonContent(ready);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return errorContent(message);
      }
    },
  );

  // -------------------------------------------------------------------------
  // task_show
  // -------------------------------------------------------------------------

  server.mcp.registerTool(
    'task_show',
    {
      description : 'Show full details of a task including subtasks, dependencies, notes.',
      inputSchema : {
        taskId: z.string().describe('ID of the task to show'),
      },
    },
    async ({ taskId }): Promise<ToolResponse> => {
      try {
        const detail = await taskStore.getTask(taskId);

        await writeAudit(
          auditTyped,
          'task_show',
          `Showed task: ${taskId.substring(0, 50)}`,
          taskId,
        );

        return jsonContent(detail);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return errorContent(message);
      }
    },
  );

  // -------------------------------------------------------------------------
  // task_list
  // -------------------------------------------------------------------------

  server.mcp.registerTool(
    'task_list',
    {
      description : 'List tasks with optional filters.',
      inputSchema : {
        status     : z.string().optional().describe('Filter by status'),
        priority   : z.string().optional().describe('Filter by priority'),
        assignee   : z.string().optional().describe('Filter by assignee'),
        type       : z.string().optional().describe('Filter by task type'),
        collection : z.string().optional().describe('Filter by collection'),
        limit      : z.number().optional().describe('Maximum number of tasks to return'),
      },
    },
    async ({ status, priority, assignee, type, collection, limit }): Promise<ToolResponse> => {
      try {
        const filters: Record<string, string> = {};
        if (status !== undefined) { filters.status = status; }
        if (priority !== undefined) { filters.priority = priority; }
        if (assignee !== undefined) { filters.assignee = assignee; }
        if (type !== undefined) { filters.type = type; }
        if (collection !== undefined) { filters.collection = collection; }

        const hasFilters = Object.keys(filters).length > 0;
        const result = await taskStore.listTasks(
          hasFilters ? filters : undefined,
          limit !== undefined ? { limit } : undefined,
        );

        await writeAudit(
          auditTyped,
          'task_list',
          `Listed ${result.records.length} tasks`,
          'query',
        );

        return jsonContent(result);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return errorContent(message);
      }
    },
  );

  // -------------------------------------------------------------------------
  // task_add_note
  // -------------------------------------------------------------------------

  server.mcp.registerTool(
    'task_add_note',
    {
      description : 'Add a note to a task.',
      inputSchema : {
        taskId  : z.string().describe('ID of the task to annotate'),
        content : z.string().describe('Note content'),
      },
    },
    async ({ taskId, content }): Promise<ToolResponse> => {
      try {
        const task = await taskStore.getTask(taskId);
        await taskStore.addNote(task.contextId!, content);

        await writeAudit(
          auditTyped,
          'task_add_note',
          `Added note to task: ${taskId.substring(0, 50)}`,
          taskId,
        );

        return jsonContent({ success: true, taskId });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return errorContent(message);
      }
    },
  );
}
