// MCP resources — registers memory-related resources on the MCP server.

import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { MemorydServer } from '../server.js';
import type { MemoryStore } from '../../core/memory-store.js';

// ---------------------------------------------------------------------------
// registerMemoryResources
// ---------------------------------------------------------------------------

export function registerMemoryResources(
  server: MemorydServer,
  memoryStore: MemoryStore,
): void {
  // -------------------------------------------------------------------------
  // memory://facts — list all facts
  // -------------------------------------------------------------------------

  server.mcp.registerResource(
    'facts-list',
    'memory://facts',
    { description: 'List all facts' },
    async (uri) => ({
      contents: [{
        uri      : uri.href,
        mimeType : 'application/json',
        text     : JSON.stringify((await memoryStore.listFacts()).records),
      }],
    }),
  );

  // -------------------------------------------------------------------------
  // memory://facts/{id} — single fact by ID
  // -------------------------------------------------------------------------

  server.mcp.registerResource(
    'fact-by-id',
    new ResourceTemplate('memory://facts/{id}', { list: undefined }),
    { description: 'A single fact by ID' },
    async (uri, { id }) => ({
      contents: [{
        uri      : uri.href,
        mimeType : 'application/json',
        text     : JSON.stringify(await memoryStore.getFact(id as string)),
      }],
    }),
  );
}
