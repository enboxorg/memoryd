#!/usr/bin/env bun

// memoryd CLI — command router.

import { flagValue, hasFlag } from './flags.js';

const VERSION = '0.0.1';

function printUsage(): void {
  console.log(`memoryd v${VERSION} — User-owned AI memory layer

Usage: memoryd <command> [options]

Commands:
  auth                          Show current identity info
  auth login                    Create or import an identity
  auth list                     List all profiles
  auth use <profile> [--global] Set active profile
  auth logout [profile]         Remove a profile

  init                          Install protocols and create sidecar DB
  serve                         Start MCP server (HTTP/SSE)
  whoami                        Print current DID

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
  --profile      Select identity profile
`);
}

async function getPassword(): Promise<string> {
  const env = process.env.MEMORYD_PASSWORD;
  if (env) { return env; }

  process.stdout.write('Vault password: ');

  if (process.stdin.isTTY) {
    // Raw mode password input — characters are not echoed.
    const password = await new Promise<string>((resolve) => {
      let buf = '';
      process.stdin.setRawMode(true);
      process.stdin.setEncoding('utf8');
      process.stdin.resume();
      const onData = (ch: string): void => {
        const code = ch.charCodeAt(0);
        if (ch === '\r' || ch === '\n') {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener('data', onData);
          process.stdout.write('\n');
          resolve(buf);
        } else if (code === 3) {
          process.stdin.setRawMode(false);
          process.stdout.write('\n');
          process.exit(130);
        } else if (code === 127 || code === 8) {
          if (buf.length > 0) { buf = buf.slice(0, -1); }
        } else if (code >= 32) {
          buf += ch;
        }
      };
      process.stdin.on('data', onData);
    });
    return password;
  }

  // Non-TTY fallback (piped stdin).
  const response = await new Promise<string>((resolve) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.once('data', (chunk: string) => {
      buf += chunk;
      resolve(buf.trim());
    });
    process.stdin.resume();
  });
  return response;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const rest = args.slice(1);

  // No-agent commands: version / help
  if (command === '--version' || command === '-v' || hasFlag(args, '--version')) {
    console.log(VERSION);
    return;
  }

  if (!command || command === 'help' || hasFlag(args, '--help') || hasFlag(args, '-h')) {
    printUsage();
    return;
  }

  // Commands that don't need agent
  switch (command) {
    case 'auth': {
      const { authCommand } = await import('./commands/auth.js');
      await authCommand(null, rest);
      return;
    }
  }

  // Commands that need agent
  const password = await getPassword();

  const { resolveProfile, profileDataPath } = await import('../profiles/config.js');
  const profileFlag = flagValue(rest, '--profile');
  const profileName = resolveProfile(profileFlag);
  const dataPath = profileName ? profileDataPath(profileName) : undefined;

  const { connectAgent } = await import('./agent.js');
  const ctx = await connectAgent({ password, dataPath });
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
    case 'whoami': {
      console.log(ctx.did);
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
