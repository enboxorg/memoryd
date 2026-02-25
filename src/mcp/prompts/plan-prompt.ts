// MCP prompt — task decomposition template for dependency-aware planning.

import { z } from 'zod';

import type { MemorydServer } from '../server.js';

// ---------------------------------------------------------------------------
// registerPlanPrompt
// ---------------------------------------------------------------------------

export function registerPlanPrompt(
  server: MemorydServer,
): void {
  server.mcp.registerPrompt(
    'plan',
    {
      description : 'Task decomposition template for dependency-aware planning.',
      argsSchema  : {
        goal: z.string().describe('The goal to decompose into tasks'),
      },
    },
    async ({ goal }) => ({
      messages: [{
        role    : 'user' as const,
        content : {
          type : 'text' as const,
          text : [
            'Break down the following goal into a dependency-aware task graph.',
            'For each task, specify title, priority (p0-p3), type, and any dependencies on other tasks.',
            '',
            `Goal: ${goal}`,
            '',
            'Respond with a structured plan using the task_create and task_add_dependency tools.',
          ].join('\n'),
        },
      }],
    }),
  );
}
