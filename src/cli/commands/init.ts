// memoryd CLI — init command: install protocols, create sidecar, sync.

import type { AgentContext } from '../agent.js';

import { bootstrapSidecar } from '../agent.js';

export async function initCommand(ctx: AgentContext, _args: string[]): Promise<void> {
  console.log('Initializing memoryd...');
  console.log(`DID: ${ctx.did}`);

  // Force protocol configuration by triggering a query on each store.
  // ensureConfigured() is called internally on first operation.
  await ctx.memoryStore.listFacts(undefined, { limit: 1 });
  await ctx.taskStore.listTasks(undefined, { limit: 1 });

  // Configure the audit protocol so action logs can be written.
  if (ctx.auditTyped) {
    await ctx.auditTyped.configure();
  }

  console.log('Protocols configured successfully.');

  // Ensure sidecar is bootstrapped (may already be from connectAgent).
  if (!ctx.sidecarDb) {
    await bootstrapSidecar(ctx);
  }

  // Sync existing DWN facts into the sidecar search index.
  if (ctx.searchIndex) {
    console.log('Syncing facts to search index...');
    const { records } = await ctx.memoryStore.listFacts();
    let indexed = 0;
    for (const fact of records) {
      if (fact.tags.status === 'active') {
        await ctx.searchIndex.upsert({
          recordId     : fact.id,
          protocolPath : 'memory/v1/fact',
          content      : fact.data.content,
          category     : fact.tags.category,
          collection   : fact.tags.collection,
        });
        indexed++;
      }
    }
    console.log(`Indexed ${indexed} fact(s).`);
  }

  console.log('memoryd is ready.');
}
