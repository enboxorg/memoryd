import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, spyOn } from 'bun:test';

const TEST_DIR = '__TESTDATA__/mcp-install';

/** Capture console.log output during a callback. */
async function captureLog(fn: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const spy = spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  });
  try {
    await fn();
  } finally {
    spy.mockRestore();
  }
  return lines;
}

/** Capture console.error output during a callback. */
async function captureError(fn: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const spy = spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  });
  try {
    await fn();
  } finally {
    spy.mockRestore();
  }
  return lines;
}

describe('mcp install/uninstall', () => {
  beforeAll(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterAll(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // --print
  // -------------------------------------------------------------------------

  describe('--print', () => {
    it('outputs valid JSON with mcpServers.memoryd entry', async () => {
      const { mcpCommand } = await import('../../src/cli/commands/mcp.js');
      const lines = await captureLog(() => mcpCommand(['install', '--print']));
      const json = JSON.parse(lines.join('\n'));
      expect(json.mcpServers).toBeDefined();
      expect(json.mcpServers.memoryd).toBeDefined();
      expect(json.mcpServers.memoryd.command).toBe('memoryd');
      expect(json.mcpServers.memoryd.args).toContain('serve');
      expect(json.mcpServers.memoryd.args).toContain('--stdio');
    });
  });

  // -------------------------------------------------------------------------
  // password in env
  // -------------------------------------------------------------------------

  describe('password inclusion', () => {
    const origPassword = process.env.MEMORYD_PASSWORD;

    afterEach(() => {
      if (origPassword !== undefined) {
        process.env.MEMORYD_PASSWORD = origPassword;
      } else {
        delete process.env.MEMORYD_PASSWORD;
      }
    });

    it('includes MEMORYD_PASSWORD in config when set', async () => {
      process.env.MEMORYD_PASSWORD = 'test-secret';
      const { mcpCommand } = await import('../../src/cli/commands/mcp.js');
      const lines = await captureLog(() => mcpCommand(['install', '--print']));
      const json = JSON.parse(lines.join('\n'));
      expect(json.mcpServers.memoryd.env.MEMORYD_PASSWORD).toBe('test-secret');
    });

    it('omits MEMORYD_PASSWORD from config when not set', async () => {
      delete process.env.MEMORYD_PASSWORD;
      const { mcpCommand } = await import('../../src/cli/commands/mcp.js');
      const lines = await captureLog(() => mcpCommand(['install', '--print']));
      const json = JSON.parse(lines.join('\n'));
      expect(json.mcpServers.memoryd.env.MEMORYD_PASSWORD).toBeUndefined();
    });

    it('warns when MEMORYD_PASSWORD is not set after install', async () => {
      delete process.env.MEMORYD_PASSWORD;
      const origCwd = process.cwd();
      const projectDir = join(TEST_DIR, 'pw-warn-project');
      mkdirSync(projectDir, { recursive: true });
      process.chdir(projectDir);
      try {
        const { mcpCommand } = await import('../../src/cli/commands/mcp.js');
        const lines = await captureLog(() => mcpCommand(['install', '--scope', 'project']));
        expect(lines.some(l => l.includes('Warning: MEMORYD_PASSWORD is not set'))).toBe(true);
      } finally {
        process.chdir(origCwd);
      }
    });

    it('does not warn when MEMORYD_PASSWORD is set', async () => {
      process.env.MEMORYD_PASSWORD = 'test-secret';
      const origCwd = process.cwd();
      const projectDir = join(TEST_DIR, 'pw-nowarn-project');
      mkdirSync(projectDir, { recursive: true });
      process.chdir(projectDir);
      try {
        const { mcpCommand } = await import('../../src/cli/commands/mcp.js');
        const lines = await captureLog(() => mcpCommand(['install', '--scope', 'project']));
        expect(lines.some(l => l.includes('Warning: MEMORYD_PASSWORD is not set'))).toBe(false);
      } finally {
        process.chdir(origCwd);
      }
    });
  });

  // -------------------------------------------------------------------------
  // --scope project
  // -------------------------------------------------------------------------

  describe('--scope project', () => {
    const origCwd = process.cwd();

    beforeEach(() => {
      const projectDir = join(TEST_DIR, 'project');
      mkdirSync(projectDir, { recursive: true });
      process.chdir(projectDir);
    });

    afterEach(() => {
      process.chdir(origCwd);
    });

    it('creates .mcp.json in cwd', async () => {
      const { mcpCommand } = await import('../../src/cli/commands/mcp.js');
      await captureLog(() => mcpCommand(['install', '--scope', 'project']));

      const mcpPath = join(process.cwd(), '.mcp.json');
      expect(existsSync(mcpPath)).toBe(true);

      const config = JSON.parse(readFileSync(mcpPath, 'utf-8'));
      expect(config.mcpServers.memoryd.command).toBe('memoryd');
      expect(config.mcpServers.memoryd.args).toContain('--stdio');
    });

    it('preserves existing entries in .mcp.json', async () => {
      const mcpPath = join(process.cwd(), '.mcp.json');
      writeFileSync(mcpPath, JSON.stringify({
        mcpServers: {
          'other-server': { command: 'other', args: [] },
        },
      }, null, 2), 'utf-8');

      const { mcpCommand } = await import('../../src/cli/commands/mcp.js');
      await captureLog(() => mcpCommand(['install', '--scope', 'project']));

      const config = JSON.parse(readFileSync(mcpPath, 'utf-8'));
      expect(config.mcpServers['other-server']).toBeDefined();
      expect(config.mcpServers.memoryd).toBeDefined();
    });

    it('uninstall removes memoryd from .mcp.json', async () => {
      const mcpPath = join(process.cwd(), '.mcp.json');
      writeFileSync(mcpPath, JSON.stringify({
        mcpServers: {
          memoryd        : { command: 'memoryd', args: ['serve', '--stdio'] },
          'other-server' : { command: 'other', args: [] },
        },
      }, null, 2), 'utf-8');

      const { mcpCommand } = await import('../../src/cli/commands/mcp.js');
      await captureLog(() => mcpCommand(['uninstall', '--scope', 'project']));

      const config = JSON.parse(readFileSync(mcpPath, 'utf-8'));
      expect(config.mcpServers.memoryd).toBeUndefined();
      expect(config.mcpServers['other-server']).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // --client cursor (file-based, testable)
  // -------------------------------------------------------------------------

  describe('--client cursor', () => {
    const origHome = process.env.HOME;
    let fakeHome: string;

    beforeEach(() => {
      fakeHome = join(TEST_DIR, 'fake-home-cursor');
      mkdirSync(join(fakeHome, '.cursor'), { recursive: true });
      process.env.HOME = fakeHome;
    });

    afterEach(() => {
      process.env.HOME = origHome;
      rmSync(fakeHome, { recursive: true, force: true });
    });

    it('writes ~/.cursor/mcp.json', async () => {
      const { mcpCommand } = await import('../../src/cli/commands/mcp.js');
      await captureLog(() => mcpCommand(['install', '--client', 'cursor']));

      const configPath = join(fakeHome, '.cursor', 'mcp.json');
      expect(existsSync(configPath)).toBe(true);

      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      expect(config.mcpServers.memoryd.command).toBe('memoryd');
    });

    it('uninstall removes from ~/.cursor/mcp.json', async () => {
      const configPath = join(fakeHome, '.cursor', 'mcp.json');
      writeFileSync(configPath, JSON.stringify({
        mcpServers: { memoryd: { command: 'memoryd', args: [] } },
      }, null, 2), 'utf-8');

      const { mcpCommand } = await import('../../src/cli/commands/mcp.js');
      await captureLog(() => mcpCommand(['uninstall', '--client', 'cursor']));

      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      expect(config.mcpServers.memoryd).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe('error handling', () => {
    it('rejects unknown subcommand', async () => {
      const { mcpCommand } = await import('../../src/cli/commands/mcp.js');
      const exitSpy = spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit');
      });
      const errLines = await captureError(async () => {
        try {
          await mcpCommand(['bogus']);
        } catch {
          // expected
        }
      });
      expect(errLines.some(l => l.includes('Unknown mcp subcommand'))).toBe(true);
      exitSpy.mockRestore();
    });

    it('rejects unknown --client', async () => {
      const { mcpCommand } = await import('../../src/cli/commands/mcp.js');
      const exitSpy = spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit');
      });
      const errLines = await captureError(async () => {
        try {
          await mcpCommand(['install', '--client', 'unknown-client']);
        } catch {
          // expected
        }
      });
      expect(errLines.some(l => l.includes('Unknown client'))).toBe(true);
      exitSpy.mockRestore();
    });
  });
});
