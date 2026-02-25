#!/usr/bin/env bun

// memoryd CLI — command router.

import { flagValue, hasFlag } from './flags.js';

const VERSION = '0.0.1';

function printUsage(): void {
  console.log(`memoryd v${VERSION} — User-owned AI memory layer

Usage: memoryd <command> [options]

Commands:
  init                          Install protocols and create sidecar DB
  serve                         Start MCP server (HTTP/SSE)

  fact add <content>            Add a fact
  fact list                     List facts
  fact search <query>           Search facts

  task create <title>           Create a task
  task list                     List tasks
  task ready                    Show unblocked tasks
  task show <id>                Show task detail
  task update <id>              Update a task
  task dep add <child> <parent> Add dependency
  task note <id> <content>      Add a note

  revoke <agent-did>            Revoke agent consent
  compact                       Compact memory store
  audit                         Show audit log

Options:
  --help, -h     Show help
  --version, -v  Show version
  --json         Output as JSON
  --password     Agent password (or set MEMORYD_PASSWORD)
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const rest = args.slice(1);

  // No-agent commands
  if (!command || command === 'help' || hasFlag(args, '--help') || hasFlag(args, '-h')) {
    printUsage();
    return;
  }

  if (command === '--version' || command === '-v' || hasFlag(args, '--version')) {
    console.log(VERSION);
    return;
  }

  // Agent-required commands
  const password = flagValue(rest, '--password') ?? process.env.MEMORYD_PASSWORD;
  if (!password) {
    console.error('Error: password required. Use --password <pw> or set MEMORYD_PASSWORD.');
    process.exit(1);
  }

  const { connectAgent } = await import('./agent.js');
  const ctx = await connectAgent(password);
  const json = hasFlag(rest, '--json');

  switch (command) {
    case 'init': {
      const { initCommand } = await import('./commands/init.js');
      await initCommand(ctx, rest);
      break;
    }
    case 'serve': {
      const { serveCommand } = await import('./commands/serve.js');
      await serveCommand(ctx, rest);
      return; // serve blocks — don't exit
    }
    case 'fact': {
      const { factCommand } = await import('./commands/fact.js');
      await factCommand(ctx, rest, json);
      break;
    }
    case 'task': {
      const { taskCommand } = await import('./commands/task.js');
      await taskCommand(ctx, rest, json);
      break;
    }
    case 'compact': {
      console.log('Memory compaction is not yet implemented. See Issue #15.');
      break;
    }
    case 'revoke': {
      const { revokeCommand } = await import('./commands/revoke.js');
      await revokeCommand(ctx, rest);
      break;
    }
    case 'audit': {
      console.log('Audit log viewer is not yet implemented.');
      break;
    }
    default: {
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
    }
  }

  process.exit(0);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
