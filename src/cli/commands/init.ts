// memoryd CLI — init command: install protocols and verify readiness.

import type { AgentContext } from '../agent.js';

export async function initCommand(ctx: AgentContext, _args: string[]): Promise<void> {
  console.log('Initializing memoryd...');
  console.log(`DID: ${ctx.did}`);

  // Force protocol configuration by triggering a query on each store.
  // ensureConfigured() is called internally on first operation.
  await ctx.memoryStore.listFacts(undefined, { limit: 1 });
  await ctx.taskStore.listTasks(undefined, { limit: 1 });

  console.log('Protocols configured successfully.');
  console.log('memoryd is ready.');
}
