// MCP resources — registers task-related resources on the MCP server.

import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { GraphEngine } from '../../core/graph.js';
import type { MemorydServer } from '../server.js';
import type { TaskStore } from '../../core/task-store.js';

// ---------------------------------------------------------------------------
// registerTaskResources
// ---------------------------------------------------------------------------

export function registerTaskResources(
  server: MemorydServer,
  taskStore: TaskStore,
  graphEngine: GraphEngine,
): void {
  // -------------------------------------------------------------------------
  // memory://tasks — list all tasks
  // -------------------------------------------------------------------------

  server.mcp.registerResource(
    'tasks-list',
    'memory://tasks',
    { description: 'List all tasks' },
    async (uri) => ({
      contents: [{
        uri      : uri.href,
        mimeType : 'application/json',
        text     : JSON.stringify((await taskStore.listTasks()).records),
      }],
    }),
  );

  // -------------------------------------------------------------------------
  // memory://tasks/ready — list ready tasks
  // -------------------------------------------------------------------------

  server.mcp.registerResource(
    'tasks-ready',
    'memory://tasks/ready',
    { description: 'List tasks that are ready to work on (all blockers resolved)' },
    async (uri) => ({
      contents: [{
        uri      : uri.href,
        mimeType : 'application/json',
        text     : JSON.stringify(await graphEngine.getReadyTasks()),
      }],
    }),
  );

  // -------------------------------------------------------------------------
  // memory://tasks/{id} — single task detail
  // -------------------------------------------------------------------------

  server.mcp.registerResource(
    'task-by-id',
    new ResourceTemplate('memory://tasks/{id}', { list: undefined }),
    { description: 'Full detail of a single task by ID' },
    async (uri, { id }) => ({
      contents: [{
        uri      : uri.href,
        mimeType : 'application/json',
        text     : JSON.stringify(await taskStore.getTask(id as string)),
      }],
    }),
  );
}
