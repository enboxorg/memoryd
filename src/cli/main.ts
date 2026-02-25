#!/usr/bin/env bun

// memoryd CLI — command router.

import { join } from 'node:path';
import { readFileSync } from 'node:fs';

import { flagValue, hasFlag } from './flags.js';

function loadVersion(): string {
  let dir = import.meta.dir;
  for (let i = 0; i < 5; i++) {
    try {
      const raw = readFileSync(join(dir, 'package.json'), 'utf8');
      return (JSON.parse(raw) as { version: string }).version;
    } catch {
      dir = join(dir, '..');
    }
  }
  return '0.0.0';
}

const VERSION = loadVersion();

function printUsage(): void {
  console.log(`memoryd v${VERSION} — User-owned AI memory layer

Usage: memoryd <command> [options]

Commands:
  auth                          Show current identity info
  auth login                    Create or import an identity
  auth list                     List all profiles
  auth use <profile> [--global] Set active profile
  auth logout [profile]         Remove a profile

  mcp install [--client <name>]  Configure MCP client (auto-detect)
  mcp install --scope project   Write .mcp.json in current directory
  mcp install --print           Print MCP config JSON
  mcp uninstall [--client <n>]  Remove memoryd from MCP client

  init                          Install protocols and create sidecar DB
  serve [--stdio] [--port N]    Start MCP server (HTTP or stdio)
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
  audit [agent-did] [--limit N] Show audit log (default: self, last 25)

Options:
  --help, -h     Show help
  --version, -v  Show version
  --json         Output as JSON
  --password     Vault password (overrides MEMORYD_PASSWORD env var)
  --profile      Select identity profile
`);
}

async function getPassword(fromFlag?: string): Promise<string> {
  if (fromFlag) { return fromFlag; }

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
    case 'mcp': {
      const { mcpCommand } = await import('./commands/mcp.js');
      await mcpCommand(rest);
      return;
    }
  }

  // Commands that need agent
  const passwordFlag = flagValue(rest, '--password');
  const password = await getPassword(passwordFlag);

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
      if (!ctx.compaction) {
        console.error('Compaction requires sidecar. Run `memoryd init` first.');
        process.exit(1);
      }
      console.log('Running compaction...');
      const result = await ctx.compaction.compact();
      console.log(`Archived stale: ${result.archivedStale}`);
      console.log(`Merged duplicates: ${result.mergedDuplicates}`);
      console.log(`Vacuumed: ${result.vacuumed}`);
      break;
    }
    case 'revoke': {
      const { revokeCommand } = await import('./commands/revoke.js');
      await revokeCommand(ctx, rest);
      break;
    }
    case 'audit': {
      if (!ctx.consentManager) {
        console.error('Consent manager not available.');
        process.exit(1);
      }
      const agentFilter = rest.find(a => !a.startsWith('--'));
      const limitStr = flagValue(rest, '--limit');
      const limit = limitStr ? parseInt(limitStr, 10) : 25;

      const entries = await ctx.consentManager.getAgentAuditLog(
        agentFilter ?? 'self', limit,
      );

      if (entries.length === 0) {
        console.log('No audit log entries found.');
        break;
      }

      if (json) {
        console.log(JSON.stringify(entries, null, 2));
      } else {
        for (const entry of entries) {
          const date = new Date(entry.dateCreated).toLocaleString();
          console.log(`[${date}] ${entry.tags.action} — ${entry.data.description ?? '(no description)'}`);
          console.log(`  protocol: ${entry.tags.targetProtocol}  record: ${entry.tags.targetRecordId}  status: ${entry.tags.status}`);
        }
      }
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
