// MCP prompt — injects relevant memories for the current conversation.

import { z } from 'zod';

import type { MemorydServer } from '../server.js';
import type { MemoryStore } from '../../core/memory-store.js';

// ---------------------------------------------------------------------------
// registerContextPrompt
// ---------------------------------------------------------------------------

export function registerContextPrompt(
  server: MemorydServer,
  memoryStore: MemoryStore,
): void {
  server.mcp.registerPrompt(
    'context',
    {
      description : 'Inject relevant memories for the current conversation.',
      argsSchema  : {
        topic: z.string().optional().describe('Focus topic for memory retrieval'),
      },
    },
    async ({ topic }) => {
      const facts = await memoryStore.listFacts(
        topic ? { category: topic } : undefined,
        { limit: 20 },
      );

      const lines = facts.records.map(
        (f) => `- [${f.tags.category}] ${f.data.content}`,
      );

      const text = lines.length > 0
        ? `Here are relevant memories for this user:\n\n${lines.join('\n')}`
        : 'No memories found for this user yet.';

      return {
        messages: [{
          role    : 'user' as const,
          content : { type: 'text' as const, text },
        }],
      };
    },
  );
}
