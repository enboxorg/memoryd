import { rmSync } from 'node:fs';

import { TaskStore } from '../../src/core/task-store.js';
import { Web5 } from '@enbox/api';
import { Web5UserAgent } from '@enbox/agent';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

const DATA_PATH = '__TESTDATA__/task-store';

describe('TaskStore', () => {
  let store: TaskStore;

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

    store = new TaskStore(result.web5);
  }, 30_000);

  afterAll(() => {
    rmSync(DATA_PATH, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // Task CRUD
  // -----------------------------------------------------------------------

  it('createTask creates a task with status open and returns id', async () => {
    const result = await store.createTask('My first task', 'p1', {
      description : 'A test task',
      type        : 'feature',
    });

    expect(result.id).toBeDefined();
    expect(typeof result.id).toBe('string');
    expect(result.contextId).toBeDefined();
    expect(result.status.code).toBe(202);
  });

  it('getTask retrieves full task detail with empty subtasks/deps/notes', async () => {
    const created = await store.createTask('Detail task', 'p2');
    const detail = await store.getTask(created.id);

    expect(detail.id).toBe(created.id);
    expect(detail.data.title).toBe('Detail task');
    expect(detail.tags.status).toBe('open');
    expect(detail.tags.priority).toBe('p2');
    expect(detail.subtasks).toEqual([]);
    expect(detail.dependencies).toEqual([]);
    expect(detail.statusHistory).toEqual([]);
    expect(detail.notes).toEqual([]);
  });

  it('listTasks returns all tasks', async () => {
    const list = await store.listTasks();
    expect(list.records.length).toBeGreaterThanOrEqual(2);
  });

  it('listTasks filters by status', async () => {
    const list = await store.listTasks({ status: 'open' });
    for (const r of list.records) {
      expect(r.tags.status).toBe('open');
    }
  });

  it('listTasks filters by priority', async () => {
    await store.createTask('P0 task', 'p0');
    const list = await store.listTasks({ priority: 'p0' });
    expect(list.records.length).toBeGreaterThanOrEqual(1);
    for (const r of list.records) {
      expect(r.tags.priority).toBe('p0');
    }
  });

  it('listTasks supports pagination', async () => {
    const page1 = await store.listTasks(undefined, { limit: 1 });
    expect(page1.records.length).toBe(1);
    expect(page1.cursor).toBeDefined();

    const page2 = await store.listTasks(undefined, { limit: 1, cursor: page1.cursor });
    expect(page2.records.length).toBe(1);
    expect(page2.records[0].id).not.toBe(page1.records[0].id);
  });

  it('updateTask updates title and priority', async () => {
    const created = await store.createTask('Original title', 'p3');
    await store.updateTask(created.id, { title: 'Updated title', priority: 'p1' });

    const detail = await store.getTask(created.id);
    expect(detail.data.title).toBe('Updated title');
    expect(detail.tags.priority).toBe('p1');
  });

  it('updateTask with status change creates statusChange record', async () => {
    const created = await store.createTask('Status test', 'p2');
    await store.updateTask(created.id, { status: 'in_progress' });

    const detail = await store.getTask(created.id);
    expect(detail.tags.status).toBe('in_progress');
    expect(detail.statusHistory.length).toBe(1);
    expect(detail.statusHistory[0].tags.from).toBe('open');
    expect(detail.statusHistory[0].tags.to).toBe('in_progress');
  });

  it('deleteTask deletes a task', async () => {
    const created = await store.createTask('To delete', 'p4');
    await store.deleteTask(created.id);

    // After deletion, listing should not include it
    const list = await store.listTasks();
    const ids = list.records.map(r => r.id);
    expect(ids).not.toContain(created.id);
  });

  // -----------------------------------------------------------------------
  // Subtasks
  // -----------------------------------------------------------------------

  it('createSubtask creates a subtask nested under parent', async () => {
    const parent = await store.createTask('Parent task', 'p1');
    const sub = await store.createSubtask(parent.contextId!, 'Child task', 'p2');

    expect(sub.id).toBeDefined();
    expect(sub.contextId).toBeDefined();
    expect(sub.status.code).toBe(202);
  });

  it('getTask on parent includes subtask in detail', async () => {
    const parent = await store.createTask('Parent with sub', 'p1');
    await store.createSubtask(parent.contextId!, 'Sub A', 'p2');

    const detail = await store.getTask(parent.id);
    expect(detail.subtasks.length).toBe(1);
    expect(detail.subtasks[0].data.title).toBe('Sub A');
    expect(detail.subtasks[0].tags.status).toBe('open');
  });

  // -----------------------------------------------------------------------
  // Dependencies
  // -----------------------------------------------------------------------

  it('addDependency creates a dependency record', async () => {
    const taskA = await store.createTask('Task A', 'p1');
    const taskB = await store.createTask('Task B', 'p1');

    await store.addDependency(taskA.contextId!, taskB.id, 'blocks', {
      description: 'A blocks B',
    });

    const detail = await store.getTask(taskA.id);
    expect(detail.dependencies.length).toBe(1);
    expect(detail.dependencies[0].tags.type).toBe('blocks');
    expect(detail.dependencies[0].tags.targetId).toBe(taskB.id);
  });

  it('getTask includes dependencies in detail', async () => {
    const task = await store.createTask('Dep parent', 'p1');
    const other = await store.createTask('Dep target', 'p2');
    await store.addDependency(task.contextId!, other.id, 'relates_to');

    const detail = await store.getTask(task.id);
    expect(detail.dependencies.length).toBe(1);
    expect(detail.dependencies[0].tags.type).toBe('relates_to');
  });

  // -----------------------------------------------------------------------
  // Status management
  // -----------------------------------------------------------------------

  it('claimTask sets assignee and transitions to in_progress', async () => {
    const created = await store.createTask('Claim me', 'p1');
    await store.claimTask(created.id, 'did:example:alice');

    const detail = await store.getTask(created.id);
    expect(detail.tags.status).toBe('in_progress');
    expect(detail.tags.assignee).toBe('did:example:alice');
  });

  it('claimTask creates a statusChange record', async () => {
    const created = await store.createTask('Claim with history', 'p2');
    await store.claimTask(created.id, 'did:example:bob');

    const detail = await store.getTask(created.id);
    expect(detail.statusHistory.length).toBe(1);
    expect(detail.statusHistory[0].tags.from).toBe('open');
    expect(detail.statusHistory[0].tags.to).toBe('in_progress');
  });

  it('getTask includes status history', async () => {
    const created = await store.createTask('History task', 'p1');
    await store.updateTask(created.id, { status: 'in_progress' });
    await store.updateTask(created.id, { status: 'closed' });

    const detail = await store.getTask(created.id);
    expect(detail.statusHistory.length).toBe(2);
  });

  // -----------------------------------------------------------------------
  // Notes
  // -----------------------------------------------------------------------

  it('addNote creates a note on a task', async () => {
    const task = await store.createTask('Note task', 'p1');
    await store.addNote(task.contextId!, 'This is a note');

    const detail = await store.getTask(task.id);
    expect(detail.notes.length).toBe(1);
    expect(detail.notes[0].data.content).toBe('This is a note');
  });

  it('getTask includes notes in detail', async () => {
    const task = await store.createTask('Multi note', 'p1');
    await store.addNote(task.contextId!, 'Note 1');
    await store.addNote(task.contextId!, 'Note 2');

    const detail = await store.getTask(task.id);
    expect(detail.notes.length).toBe(2);
  });
});
