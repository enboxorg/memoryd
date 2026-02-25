import { rmSync } from 'node:fs';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Web5 } from '@enbox/api';
import { Web5UserAgent } from '@enbox/agent';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { GraphEngine } from '../../../src/core/graph.js';
import { MemorydServer } from '../../../src/mcp/server.js';
import { registerTaskTools } from '../../../src/mcp/tools/task-tools.js';
import { TaskStore } from '../../../src/core/task-store.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DATA_PATH = '__TESTDATA__/task-tools';

type ToolResult = {
  content: { type: string; text: string }[];
  isError?: boolean;
};

function parseResult(result: ToolResult): unknown {
  const text = result.content[0]?.text;
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let server: MemorydServer;
let client: Client;
let taskStore: TaskStore;
let port: number;

beforeAll(async () => {
  rmSync(DATA_PATH, { recursive: true, force: true });

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
          { algorithm: 'Ed25519', purposes: ['authentication', 'assertionMethod'] },
          { algorithm: 'X25519', purposes: ['keyAgreement'] },
        ],
      },
    });
  }

  const result = await Web5.connect({
    agent,
    connectedDid : identity.did.uri,
    sync         : 'off',
  });

  taskStore = new TaskStore(result.web5);
  const graphEngine = new GraphEngine(taskStore);

  server = new MemorydServer({ port: 0 });
  registerTaskTools(server, taskStore, graphEngine);
  const httpResult = await server.startHttp();
  port = httpResult.port;

  client = new Client({ name: 'test', version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://localhost:${port}/mcp`),
  );
  await client.connect(transport);
}, 30_000);

afterAll(async () => {
  await client.close();
  await server.stop();
  rmSync(DATA_PATH, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('task tools — registration', () => {
  it('listTools shows all 7 task tools registered', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);

    expect(names).toContain('task_create');
    expect(names).toContain('task_update');
    expect(names).toContain('task_add_dependency');
    expect(names).toContain('task_ready');
    expect(names).toContain('task_show');
    expect(names).toContain('task_list');
    expect(names).toContain('task_add_note');
    expect(names.filter((n) => n.startsWith('task_')).length).toBe(7);
  }, 30_000);
});

describe('task tools — task_create', () => {
  it('creates a task', async () => {
    const result = await client.callTool({
      name      : 'task_create',
      arguments : { title: 'Test task', priority: 'p1' },
    }) as ToolResult;

    expect(result.isError).toBeUndefined();
    const parsed = parseResult(result) as { id: string; contextId: string; status: { code: number } };
    expect(parsed.id).toBeDefined();
    expect(typeof parsed.id).toBe('string');
    expect(parsed.contextId).toBeDefined();
    expect(parsed.status.code).toBe(202);
  }, 30_000);

  it('creates a subtask with parentTaskId', async () => {
    // Create parent first
    const parentResult = await client.callTool({
      name      : 'task_create',
      arguments : { title: 'Parent task', priority: 'p1' },
    }) as ToolResult;
    const parent = parseResult(parentResult) as { id: string };

    // Create subtask
    const subResult = await client.callTool({
      name      : 'task_create',
      arguments : { title: 'Subtask', priority: 'p2', parentTaskId: parent.id },
    }) as ToolResult;

    expect(subResult.isError).toBeUndefined();
    const parsed = parseResult(subResult) as { id: string; contextId: string; status: { code: number } };
    expect(parsed.id).toBeDefined();
    expect(parsed.status.code).toBe(202);

    // Verify parent shows subtask
    const showResult = await client.callTool({
      name      : 'task_show',
      arguments : { taskId: parent.id },
    }) as ToolResult;
    const detail = parseResult(showResult) as { subtasks: { data: { title: string } }[] };
    expect(detail.subtasks.length).toBe(1);
    expect(detail.subtasks[0].data.title).toBe('Subtask');
  }, 30_000);
});

describe('task tools — task_update', () => {
  it('changes status', async () => {
    const createResult = await client.callTool({
      name      : 'task_create',
      arguments : { title: 'Update me', priority: 'p2' },
    }) as ToolResult;
    const created = parseResult(createResult) as { id: string };

    const updateResult = await client.callTool({
      name      : 'task_update',
      arguments : { taskId: created.id, status: 'in_progress' },
    }) as ToolResult;

    expect(updateResult.isError).toBeUndefined();

    // Verify status changed
    const showResult = await client.callTool({
      name      : 'task_show',
      arguments : { taskId: created.id },
    }) as ToolResult;
    const detail = parseResult(showResult) as { tags: { status: string } };
    expect(detail.tags.status).toBe('in_progress');
  }, 30_000);

  it('with claim=true does atomic claim', async () => {
    const createResult = await client.callTool({
      name      : 'task_create',
      arguments : { title: 'Claim me', priority: 'p1' },
    }) as ToolResult;
    const created = parseResult(createResult) as { id: string };

    const claimResult = await client.callTool({
      name      : 'task_update',
      arguments : { taskId: created.id, claim: true, assignee: 'did:example:alice' },
    }) as ToolResult;

    expect(claimResult.isError).toBeUndefined();

    // Verify claim
    const showResult = await client.callTool({
      name      : 'task_show',
      arguments : { taskId: created.id },
    }) as ToolResult;
    const detail = parseResult(showResult) as { tags: { status: string; assignee: string } };
    expect(detail.tags.status).toBe('in_progress');
    expect(detail.tags.assignee).toBe('did:example:alice');
  }, 30_000);
});

describe('task tools — task_add_dependency', () => {
  it('links tasks', async () => {
    const aResult = await client.callTool({
      name      : 'task_create',
      arguments : { title: 'Task A', priority: 'p1' },
    }) as ToolResult;
    const a = parseResult(aResult) as { id: string };

    const bResult = await client.callTool({
      name      : 'task_create',
      arguments : { title: 'Task B', priority: 'p1' },
    }) as ToolResult;
    const b = parseResult(bResult) as { id: string };

    // A is blocked by B
    const depResult = await client.callTool({
      name      : 'task_add_dependency',
      arguments : { taskId: a.id, dependsOn: b.id },
    }) as ToolResult;

    expect(depResult.isError).toBeUndefined();
    const parsed = parseResult(depResult) as { success: boolean; taskId: string; dependsOn: string };
    expect(parsed.success).toBe(true);

    // Verify dependency
    const showResult = await client.callTool({
      name      : 'task_show',
      arguments : { taskId: a.id },
    }) as ToolResult;
    const detail = parseResult(showResult) as { dependencies: { tags: { targetId: string } }[] };
    expect(detail.dependencies.length).toBe(1);
    expect(detail.dependencies[0].tags.targetId).toBe(b.id);
  }, 30_000);

  it('detects cycles and returns error', async () => {
    const aResult = await client.callTool({
      name      : 'task_create',
      arguments : { title: 'Cycle A', priority: 'p1' },
    }) as ToolResult;
    const a = parseResult(aResult) as { id: string };

    const bResult = await client.callTool({
      name      : 'task_create',
      arguments : { title: 'Cycle B', priority: 'p1' },
    }) as ToolResult;
    const b = parseResult(bResult) as { id: string };

    // A is blocked by B
    await client.callTool({
      name      : 'task_add_dependency',
      arguments : { taskId: a.id, dependsOn: b.id },
    });

    // Try to add B blocked by A — should detect cycle
    const cycleResult = await client.callTool({
      name      : 'task_add_dependency',
      arguments : { taskId: b.id, dependsOn: a.id },
    }) as ToolResult;

    expect(cycleResult.isError).toBe(true);
    const errorText = cycleResult.content[0].text;
    expect(errorText).toContain('Cycle detected');
  }, 30_000);
});

describe('task tools — task_ready', () => {
  it('returns unblocked tasks', async () => {
    const collection = `ready-${Date.now()}`;

    // Create two tasks in a unique collection
    const freeResult = await client.callTool({
      name      : 'task_create',
      arguments : { title: 'Free task', priority: 'p1', collection },
    }) as ToolResult;
    const free = parseResult(freeResult) as { id: string };

    const blockerResult = await client.callTool({
      name      : 'task_create',
      arguments : { title: 'Blocker', priority: 'p1', collection },
    }) as ToolResult;
    const blocker = parseResult(blockerResult) as { id: string };

    const blockedResult = await client.callTool({
      name      : 'task_create',
      arguments : { title: 'Blocked', priority: 'p1', collection },
    }) as ToolResult;
    const blocked = parseResult(blockedResult) as { id: string };

    // blocked depends on blocker
    await client.callTool({
      name      : 'task_add_dependency',
      arguments : { taskId: blocked.id, dependsOn: blocker.id },
    });

    const readyResult = await client.callTool({
      name      : 'task_ready',
      arguments : { collection },
    }) as ToolResult;

    const ready = parseResult(readyResult) as { id: string }[];
    const readyIds = ready.map((r) => r.id);

    // free should be ready, blocker should be ready, blocked should NOT
    expect(readyIds).toContain(free.id);
    expect(readyIds).toContain(blocker.id);
    expect(readyIds).not.toContain(blocked.id);
  }, 30_000);
});

describe('task tools — task_show', () => {
  it('returns full detail', async () => {
    const createResult = await client.callTool({
      name      : 'task_create',
      arguments : { title: 'Show me', priority: 'p2', description: 'A detailed task' },
    }) as ToolResult;
    const created = parseResult(createResult) as { id: string };

    const showResult = await client.callTool({
      name      : 'task_show',
      arguments : { taskId: created.id },
    }) as ToolResult;

    expect(showResult.isError).toBeUndefined();
    const detail = parseResult(showResult) as {
      id: string;
      data: { title: string; description: string };
      tags: { status: string; priority: string };
      subtasks: unknown[];
      dependencies: unknown[];
      notes: unknown[];
    };

    expect(detail.id).toBe(created.id);
    expect(detail.data.title).toBe('Show me');
    expect(detail.data.description).toBe('A detailed task');
    expect(detail.tags.status).toBe('open');
    expect(detail.tags.priority).toBe('p2');
    expect(detail.subtasks).toEqual([]);
    expect(detail.dependencies).toEqual([]);
    expect(detail.notes).toEqual([]);
  }, 30_000);
});

describe('task tools — task_list', () => {
  it('lists tasks with filters', async () => {
    const collection = `list-${Date.now()}`;

    await client.callTool({
      name      : 'task_create',
      arguments : { title: 'P0 item', priority: 'p0', collection },
    });
    await client.callTool({
      name      : 'task_create',
      arguments : { title: 'P3 item', priority: 'p3', collection },
    });

    const listResult = await client.callTool({
      name      : 'task_list',
      arguments : { priority: 'p0', collection },
    }) as ToolResult;

    expect(listResult.isError).toBeUndefined();
    const list = parseResult(listResult) as { records: { tags: { priority: string } }[] };
    expect(list.records.length).toBeGreaterThanOrEqual(1);
    for (const r of list.records) {
      expect(r.tags.priority).toBe('p0');
    }
  }, 30_000);
});

describe('task tools — task_add_note', () => {
  it('annotates a task', async () => {
    const createResult = await client.callTool({
      name      : 'task_create',
      arguments : { title: 'Note task', priority: 'p1' },
    }) as ToolResult;
    const created = parseResult(createResult) as { id: string };

    const noteResult = await client.callTool({
      name      : 'task_add_note',
      arguments : { taskId: created.id, content: 'This is a note' },
    }) as ToolResult;

    expect(noteResult.isError).toBeUndefined();
    const parsed = parseResult(noteResult) as { success: boolean };
    expect(parsed.success).toBe(true);

    // Verify note was added
    const showResult = await client.callTool({
      name      : 'task_show',
      arguments : { taskId: created.id },
    }) as ToolResult;
    const detail = parseResult(showResult) as { notes: { data: { content: string } }[] };
    expect(detail.notes.length).toBe(1);
    expect(detail.notes[0].data.content).toBe('This is a note');
  }, 30_000);
});
