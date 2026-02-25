// memoryd CLI — fact command: add, list, search facts.

import type { AgentContext } from '../agent.js';

import { flagValue } from '../flags.js';

/**
 * Collect positional arguments (those not starting with '--' and not a value
 * following a flag).  Returns all non-flag tokens in order.
 */
function positionalArgs(args: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      i++; // skip flag value
      continue;
    }
    result.push(args[i]);
  }
  return result;
}

export async function factCommand(ctx: AgentContext, args: string[], json: boolean): Promise<void> {
  const sub = args[0];
  const subArgs = args.slice(1);

  switch (sub) {
    case 'add': {
      const positional = positionalArgs(subArgs);
      const content = positional[0];
      if (!content) {
        console.error('Usage: memoryd fact add <content> [--category <cat>] [--source <src>]');
        process.exit(1);
      }
      const category = flagValue(subArgs, '--category') ?? 'general';
      const source = flagValue(subArgs, '--source') ?? 'user';
      const confStr = flagValue(subArgs, '--confidence');
      const collection = flagValue(subArgs, '--collection');
      const result = await ctx.memoryStore.addFact(content, category, source, {
        confidence: confStr ? Number(confStr) : undefined,
        collection,
      });
      if (json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`Fact added: ${result.id}`);
      }
      break;
    }
    case 'list': {
      const category = flagValue(subArgs, '--category');
      const collection = flagValue(subArgs, '--collection');
      const limitStr = flagValue(subArgs, '--limit');
      const result = await ctx.memoryStore.listFacts(
        {
          ...(category ? { category } : {}),
          ...(collection ? { collection } : {}),
        },
        limitStr ? { limit: Number(limitStr) } : undefined,
      );
      if (json) {
        console.log(JSON.stringify(result.records, null, 2));
      } else if (result.records.length === 0) {
        console.log('No facts found.');
      } else {
        for (const f of result.records) {
          console.log(`[${f.tags.category}] ${f.data.content} (${f.id})`);
        }
      }
      break;
    }
    case 'search': {
      const positional = positionalArgs(subArgs);
      const query = positional[0];
      if (!query) {
        console.error('Usage: memoryd fact search <query>');
        process.exit(1);
      }
      console.log('Note: Full hybrid search requires sidecar setup. Showing filtered results.');
      const result = await ctx.memoryStore.listFacts();
      const filtered = result.records.filter(
        f => f.data.content.toLowerCase().includes(query.toLowerCase()),
      );
      if (json) {
        console.log(JSON.stringify(filtered, null, 2));
      } else if (filtered.length === 0) {
        console.log('No matching facts found.');
      } else {
        for (const f of filtered) {
          console.log(`[${f.tags.category}] ${f.data.content} (${f.id})`);
        }
      }
      break;
    }
    default: {
      console.error(`Unknown fact subcommand: ${sub}`);
      console.error('Usage: memoryd fact <add|list|search>');
      process.exit(1);
    }
  }
}
