/**
 * MCP client configuration — install/uninstall memoryd as an MCP server
 * in Claude Code, Cursor, and Claude Desktop.
 *
 * All operations are file-based (no agent needed).
 *
 * @module
 */

import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { flagValue, hasFlag } from '../flags.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SERVER_NAME = 'memoryd';

/** Build the config entry, prompting for password if needed. */
function serverEntry(): Record<string, unknown> {
  const password = process.env.MEMORYD_PASSWORD;
  const env: Record<string, string> = {};
  if (password) {
    env.MEMORYD_PASSWORD = password;
  }
  return {
    command : SERVER_NAME,
    args    : ['serve', '--stdio'],
    env,
  };
}

// ---------------------------------------------------------------------------
// Client definitions
// ---------------------------------------------------------------------------

type ClientId = 'claude-code' | 'cursor' | 'claude-desktop';

type ClientDef = {
  id : ClientId;
  label : string;
  detect : () => boolean;
  install : () => void;
  uninstall : () => void;
};

/** Read HOME at call time (not cached like `os.homedir()`). */
function home(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? '/';
}

function cursorGlobalPath(): string {
  return join(home(), '.cursor', 'mcp.json');
}

function claudeDesktopPath(): string {
  if (process.platform === 'darwin') {
    return join(home(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  }
  return join(home(), '.config', 'Claude', 'claude_desktop_config.json');
}

function claudeCodeAvailable(): boolean {
  try {
    execSync('claude --version', { stdio: 'pipe', timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// JSON config helpers
// ---------------------------------------------------------------------------

type McpConfig = {
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
};

function readJsonConfig(path: string): McpConfig {
  if (!existsSync(path)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as McpConfig;
  } catch {
    return {};
  }
}

function writeJsonConfig(path: string, config: McpConfig): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

function addServerToConfig(path: string): void {
  const config = readJsonConfig(path);
  config.mcpServers = config.mcpServers ?? {};
  config.mcpServers[SERVER_NAME] = serverEntry();
  writeJsonConfig(path, config);
}

function removeServerFromConfig(path: string): boolean {
  if (!existsSync(path)) { return false; }
  const config = readJsonConfig(path);
  if (!config.mcpServers || !(SERVER_NAME in config.mcpServers)) {
    return false;
  }
  delete config.mcpServers[SERVER_NAME];
  writeJsonConfig(path, config);
  return true;
}

// ---------------------------------------------------------------------------
// Client implementations
// ---------------------------------------------------------------------------

function makeClients(): ClientDef[] {
  return [
    {
      id      : 'claude-code',
      label   : 'Claude Code',
      detect  : (): boolean => claudeCodeAvailable(),
      install : (): void => {
        execSync(
          `claude mcp add -s user -t stdio ${SERVER_NAME} -- ${SERVER_NAME} serve --stdio`,
          { stdio: 'pipe', timeout: 10_000 },
        );
      },
      uninstall: (): void => {
        try {
          execSync(
            `claude mcp remove -s user ${SERVER_NAME}`,
            { stdio: 'pipe', timeout: 10_000 },
          );
        } catch {
          // Ignore if not found.
        }
      },
    },
    {
      id        : 'cursor',
      label     : 'Cursor',
      detect    : (): boolean => existsSync(join(home(), '.cursor')),
      install   : (): void => { addServerToConfig(cursorGlobalPath()); },
      uninstall : (): void => { removeServerFromConfig(cursorGlobalPath()); },
    },
    {
      id        : 'claude-desktop',
      label     : 'Claude Desktop',
      detect    : (): boolean => existsSync(dirname(claudeDesktopPath())),
      install   : (): void => { addServerToConfig(claudeDesktopPath()); },
      uninstall : (): void => { removeServerFromConfig(claudeDesktopPath()); },
    },
  ];
}

// ---------------------------------------------------------------------------
// Project-level install
// ---------------------------------------------------------------------------

function installProject(): void {
  const path = join(process.cwd(), '.mcp.json');
  addServerToConfig(path);
  console.log(`Wrote ${path}`);
}

function uninstallProject(): void {
  const path = join(process.cwd(), '.mcp.json');
  if (removeServerFromConfig(path)) {
    console.log(`Removed memoryd from ${path}`);
  } else {
    console.log('memoryd not found in .mcp.json');
  }
}

// ---------------------------------------------------------------------------
// Print
// ---------------------------------------------------------------------------

function printConfig(): void {
  const config = {
    mcpServers: {
      [SERVER_NAME]: serverEntry(),
    },
  };
  console.log(JSON.stringify(config, null, 2));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Warn if MEMORYD_PASSWORD is not set after install. */
function warnIfNoPassword(): void {
  if (!process.env.MEMORYD_PASSWORD) {
    console.log('');
    console.log(
      'Warning: MEMORYD_PASSWORD is not set. Add it to your MCP client\'s env '
      + 'config or memoryd will prompt for a password on stdin '
      + '(incompatible with stdio transport).',
    );
  }
}

// ---------------------------------------------------------------------------
// Public command
// ---------------------------------------------------------------------------

export async function mcpCommand(args: string[]): Promise<void> {
  const sub = args[0];

  switch (sub) {
    case 'install': {
      await mcpInstall(args.slice(1));
      break;
    }
    case 'uninstall': {
      await mcpUninstall(args.slice(1));
      break;
    }
    default: {
      console.error(`Unknown mcp subcommand: ${sub}`);
      console.error('Usage: memoryd mcp <install|uninstall>');
      console.error('  memoryd mcp install [--client <name>] [--scope project] [--print]');
      console.error('  memoryd mcp uninstall [--client <name>] [--scope project]');
      process.exit(1);
    }
  }
}

// ---------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------

async function mcpInstall(args: string[]): Promise<void> {
  // --print: just output the JSON
  if (hasFlag(args, '--print')) {
    printConfig();
    return;
  }

  // --scope project: write .mcp.json in cwd
  const scope = flagValue(args, '--scope');
  if (scope === 'project') {
    installProject();
    warnIfNoPassword();
    return;
  }

  // --client <name>: target a specific client
  const clientId = flagValue(args, '--client') as ClientId | undefined;

  if (clientId) {
    const clients = makeClients();
    const client = clients.find(c => c.id === clientId);
    if (!client) {
      console.error(`Unknown client: ${clientId}`);
      console.error('Supported: claude-code, cursor, claude-desktop');
      process.exit(1);
    }
    client.install();
    console.log(`Installed memoryd in ${client.label}.`);
    warnIfNoPassword();
    return;
  }

  // Auto-detect: install in all detected clients
  const clients = makeClients();
  const detected = clients.filter(c => c.detect());

  if (detected.length === 0) {
    console.log('No supported MCP clients detected.');
    console.log('Use --print to get the JSON config for manual setup:');
    console.log('  memoryd mcp install --print');
    return;
  }

  for (const client of detected) {
    try {
      client.install();
      console.log(`Installed memoryd in ${client.label}.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Failed to install in ${client.label}: ${msg}`);
    }
  }

  warnIfNoPassword();
}

// ---------------------------------------------------------------------------
// Uninstall
// ---------------------------------------------------------------------------

async function mcpUninstall(args: string[]): Promise<void> {
  // --scope project: remove from .mcp.json
  const scope = flagValue(args, '--scope');
  if (scope === 'project') {
    uninstallProject();
    return;
  }

  // --client <name>: target a specific client
  const clientId = flagValue(args, '--client') as ClientId | undefined;

  if (clientId) {
    const clients = makeClients();
    const client = clients.find(c => c.id === clientId);
    if (!client) {
      console.error(`Unknown client: ${clientId}`);
      console.error('Supported: claude-code, cursor, claude-desktop');
      process.exit(1);
    }
    client.uninstall();
    console.log(`Removed memoryd from ${client.label}.`);
    return;
  }

  // Auto-detect: uninstall from all detected clients
  const clients = makeClients();
  const detected = clients.filter(c => c.detect());

  if (detected.length === 0) {
    console.log('No supported MCP clients detected.');
    return;
  }

  for (const client of detected) {
    try {
      client.uninstall();
      console.log(`Removed memoryd from ${client.label}.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Failed to remove from ${client.label}: ${msg}`);
    }
  }
}
