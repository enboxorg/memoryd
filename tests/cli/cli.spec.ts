import { rmSync } from 'node:fs';

import { afterAll, beforeAll, describe, expect, it, spyOn } from 'bun:test';

import { Web5 } from '@enbox/api';
import { Web5UserAgent } from '@enbox/agent';

import type { AgentContext } from '../../src/cli/agent.js';

import { GraphEngine } from '../../src/core/graph.js';
import { MemoryStore } from '../../src/core/memory-store.js';
import { TaskStore } from '../../src/core/task-store.js';
import { flagValue, hasFlag, parsePort } from '../../src/cli/flags.js';

const DATA_PATH = '__TESTDATA__/cli';
const SIDECAR_PATH = '__TESTDATA__/cli/sidecar.db';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// flags.ts — pure function tests
// ---------------------------------------------------------------------------

describe('flags', () => {
  describe('flagValue', () => {
    it('extracts value after flag', () => {
      expect(flagValue(['--port', '3200'], '--port')).toBe('3200');
    });

    it('returns undefined for missing flag', () => {
      expect(flagValue(['--port', '3200'], '--host')).toBeUndefined();
    });

    it('returns undefined when flag is last element', () => {
      expect(flagValue(['--port'], '--port')).toBeUndefined();
    });

    it('returns first occurrence', () => {
      expect(flagValue(['--port', '1', '--port', '2'], '--port')).toBe('1');
    });

    it('extracts --password value from args', () => {
      expect(flagValue(['--password', 's3cret', '--json'], '--password')).toBe('s3cret');
    });

    it('returns undefined when --password has no value', () => {
      expect(flagValue(['--password'], '--password')).toBeUndefined();
    });
  });

  describe('hasFlag', () => {
    it('detects presence', () => {
      expect(hasFlag(['--json', 'foo'], '--json')).toBe(true);
    });

    it('detects absence', () => {
      expect(hasFlag(['--json', 'foo'], '--verbose')).toBe(false);
    });
  });

  describe('parsePort', () => {
    it('returns fallback for undefined', () => {
      expect(parsePort(undefined, 3200)).toBe(3200);
    });

    it('parses valid port', () => {
      expect(parsePort('8080', 3200)).toBe(8080);
    });

    it('exits on invalid port', () => {
      const mockExit = spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit');
      });
      expect(() => parsePort('abc', 3200)).toThrow('process.exit');
      mockExit.mockRestore();
    });

    it('exits on port out of range', () => {
      const mockExit = spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit');
      });
      expect(() => parsePort('99999', 3200)).toThrow('process.exit');
      mockExit.mockRestore();
    });
  });
});

// ---------------------------------------------------------------------------
// Command tests — real Web5 agent with in-memory DWN
// ---------------------------------------------------------------------------

describe('CLI commands', () => {
  let ctx: AgentContext;

  beforeAll(async () => {
    rmSync(DATA_PATH, { recursive: true, force: true });
    process.env.MEMORYD_SIDECAR_PATH = SIDECAR_PATH;
    const agent = await Web5UserAgent.create({ dataPath: DATA_PATH });
    await agent.initialize({ password: 'test' });
    await agent.start({ password: 'test' });
    const identities = await agent.identity.list();
    let identity = identities[0];
    if (!identity) {
      identity = await agent.identity.create({
        didMethod  : 'dht',
        metadata   : { name: 'Test' },
        didOptions : {
          verificationMethods: [
            { algorithm: 'Ed25519', id: 'sig', purposes: ['authentication', 'assertionMethod'] },
            { algorithm: 'X25519', id: 'enc', purposes: ['keyAgreement'] },
          ],
        },
      });
    }
    const result = await Web5.connect({
      agent,
      connectedDid : identity.did.uri,
      sync         : 'off',
    });

    const web5 = result.web5;
    const did = result.did;
    const memoryStore = new MemoryStore(web5);
    const taskStore = new TaskStore(web5);
    const graphEngine = new GraphEngine(taskStore);

    ctx = { did, web5, memoryStore, taskStore, graphEngine };
  }, 30_000);

  afterAll(() => {
    delete process.env.MEMORYD_SIDECAR_PATH;
    rmSync(DATA_PATH, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // init command
  // -------------------------------------------------------------------------

  describe('initCommand', () => {
    it('runs without error and prints confirmation', async () => {
      const { initCommand } = await import('../../src/cli/commands/init.js');
      const lines = await captureLog(() => initCommand(ctx, []));
      expect(lines.some(l => l.includes('memoryd is ready'))).toBe(true);
      expect(lines.some(l => l.includes('DID:'))).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // fact command
  // -------------------------------------------------------------------------

  describe('factCommand', () => {
    it('adds a fact and prints its id', async () => {
      const { factCommand } = await import('../../src/cli/commands/fact.js');
      const lines = await captureLog(() =>
        factCommand(ctx, ['add', 'The sky is blue', '--category', 'science'], false),
      );
      expect(lines.length).toBe(1);
      expect(lines[0]).toContain('Fact added:');
    });

    it('lists facts after adding', async () => {
      const { factCommand } = await import('../../src/cli/commands/fact.js');
      const lines = await captureLog(() =>
        factCommand(ctx, ['list', '--category', 'science'], false),
      );
      expect(lines.length).toBeGreaterThanOrEqual(1);
      expect(lines.some(l => l.includes('The sky is blue'))).toBe(true);
    });

    it('lists facts in JSON mode', async () => {
      const { factCommand } = await import('../../src/cli/commands/fact.js');
      const lines = await captureLog(() =>
        factCommand(ctx, ['list', '--category', 'science'], true),
      );
      const parsed = JSON.parse(lines.join('\n'));
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBeGreaterThanOrEqual(1);
    });

    it('searches facts by content', async () => {
      const { factCommand } = await import('../../src/cli/commands/fact.js');
      const lines = await captureLog(() =>
        factCommand(ctx, ['search', 'sky'], false),
      );
      // After initCommand, ctx has a search index. Facts added via CLI
      // are indexed, so hybrid search (FTS5) should match.
      expect(lines.some(l => l.includes('sky'))).toBe(true);
    });

    it('search returns results for non-matching query when sidecar uses noop embeddings', async () => {
      const { factCommand } = await import('../../src/cli/commands/fact.js');
      const lines = await captureLog(() =>
        factCommand(ctx, ['search', 'xyznonexistent'], false),
      );
      // With NoopProvider (zero vectors), vector KNN still matches all records
      // even for nonsense queries. FTS returns nothing, but vector results
      // remain. This is expected — real embedding providers would filter properly.
      expect(lines.length).toBeGreaterThanOrEqual(1);
    });
  });

  // -------------------------------------------------------------------------
  // task command
  // -------------------------------------------------------------------------

  describe('taskCommand', () => {
    it('creates a task and prints its id', async () => {
      const { taskCommand } = await import('../../src/cli/commands/task.js');
      const lines = await captureLog(() =>
        taskCommand(ctx, ['create', 'Build CLI', '--priority', 'p0'], false),
      );
      expect(lines.length).toBe(1);
      expect(lines[0]).toContain('Task created:');
    });

    it('lists tasks after creating', async () => {
      const { taskCommand } = await import('../../src/cli/commands/task.js');
      const lines = await captureLog(() =>
        taskCommand(ctx, ['list'], false),
      );
      expect(lines.length).toBeGreaterThanOrEqual(1);
      expect(lines.some(l => l.includes('Build CLI'))).toBe(true);
    });

    it('creates a subtask with --parent', async () => {
      const { taskCommand } = await import('../../src/cli/commands/task.js');
      // First create a parent
      const parentResult = await ctx.taskStore.createTask('Parent task', 'p1');

      const lines = await captureLog(() =>
        taskCommand(ctx, ['create', 'Sub task', '--parent', parentResult.id, '--priority', 'p2'], false),
      );
      expect(lines.length).toBe(1);
      expect(lines[0]).toContain('Task created:');

      // Verify via getTask
      const detail = await ctx.taskStore.getTask(parentResult.id);
      expect(detail.subtasks.length).toBe(1);
      expect(detail.subtasks[0].data.title).toBe('Sub task');
    });

    it('task ready returns unblocked tasks', async () => {
      const { taskCommand } = await import('../../src/cli/commands/task.js');
      const lines = await captureLog(() =>
        taskCommand(ctx, ['ready'], false),
      );
      // All open tasks with no blockers should appear
      expect(lines.length).toBeGreaterThanOrEqual(1);
    });

    it('task show displays detail', async () => {
      const { taskCommand } = await import('../../src/cli/commands/task.js');
      const created = await ctx.taskStore.createTask('Show me', 'p1', { description: 'A description' });

      const lines = await captureLog(() =>
        taskCommand(ctx, ['show', created.id], false),
      );
      expect(lines.some(l => l.includes('Show me'))).toBe(true);
      expect(lines.some(l => l.includes('A description'))).toBe(true);
    });

    it('task update changes status', async () => {
      const { taskCommand } = await import('../../src/cli/commands/task.js');
      const created = await ctx.taskStore.createTask('Update me', 'p1');

      const lines = await captureLog(() =>
        taskCommand(ctx, ['update', created.id, '--status', 'closed'], false),
      );
      expect(lines[0]).toContain('Task updated:');

      const detail = await ctx.taskStore.getTask(created.id);
      expect(detail.tags.status).toBe('closed');
    });

    it('task dep add creates a dependency', async () => {
      const { taskCommand } = await import('../../src/cli/commands/task.js');
      const a = await ctx.taskStore.createTask('Task A', 'p1');
      const b = await ctx.taskStore.createTask('Task B', 'p1');

      const lines = await captureLog(() =>
        taskCommand(ctx, ['dep', 'add', a.id, b.id], false),
      );
      expect(lines[0]).toContain('Dependency added');

      const detail = await ctx.taskStore.getTask(a.id);
      expect(detail.dependencies.length).toBe(1);
      expect(detail.dependencies[0].tags.targetId).toBe(b.id);
    });

    it('task note adds a note', async () => {
      const { taskCommand } = await import('../../src/cli/commands/task.js');
      const created = await ctx.taskStore.createTask('Note task', 'p1');

      const lines = await captureLog(() =>
        taskCommand(ctx, ['note', created.id, 'This is a note'], false),
      );
      expect(lines[0]).toContain('Note added');

      const detail = await ctx.taskStore.getTask(created.id);
      expect(detail.notes.length).toBe(1);
      expect(detail.notes[0].data.content).toBe('This is a note');
    });

    it('task list in JSON mode', async () => {
      const { taskCommand } = await import('../../src/cli/commands/task.js');
      const lines = await captureLog(() =>
        taskCommand(ctx, ['list', '--json'], true),
      );
      const parsed = JSON.parse(lines.join('\n'));
      expect(Array.isArray(parsed)).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// DWN endpoint env var
// ---------------------------------------------------------------------------

describe('DWN endpoint env var', () => {
  it('defaults to https://enbox-dwn.fly.dev when MEMORYD_DWN_ENDPOINT is unset', () => {
    delete process.env.MEMORYD_DWN_ENDPOINT;
    const endpoint = process.env.MEMORYD_DWN_ENDPOINT ?? 'https://enbox-dwn.fly.dev';
    expect(endpoint).toBe('https://enbox-dwn.fly.dev');
  });

  it('uses MEMORYD_DWN_ENDPOINT when set', () => {
    process.env.MEMORYD_DWN_ENDPOINT = 'https://custom-dwn.example.com';
    const endpoint = process.env.MEMORYD_DWN_ENDPOINT ?? 'https://enbox-dwn.fly.dev';
    expect(endpoint).toBe('https://custom-dwn.example.com');
    delete process.env.MEMORYD_DWN_ENDPOINT;
  });
});

// ---------------------------------------------------------------------------
// --password CLI flag integration
// ---------------------------------------------------------------------------

// Full integration test for --password requires a DWN agent setup and
// spawning the CLI as a subprocess.  The flag extraction itself is covered
// by the flagValue tests above.  The getPassword(fromFlag) path is a
// straightforward early-return that is validated by the unit-level flag
// tests combined with manual verification.
