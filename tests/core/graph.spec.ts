import { rmSync } from 'node:fs';

import { GraphEngine } from '../../src/core/graph.js';
import { TaskStore } from '../../src/core/task-store.js';
import type { TaskTreeNode } from '../../src/core/graph.js';
import { Web5 } from '@enbox/api';
import { Web5UserAgent } from '@enbox/agent';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

const DATA_PATH = '__TESTDATA__/graph-engine';

describe('GraphEngine', () => {
  let store: TaskStore;
  let engine: GraphEngine;

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
    engine = new GraphEngine(store);
  }, 30_000);

  afterAll(() => {
    rmSync(DATA_PATH, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // getReadyTasks
  // -----------------------------------------------------------------------

  it('task with no dependencies is ready', async () => {
    const t = await store.createTask('No deps', 'p1');
    const ready = await engine.getReadyTasks();
    const ids = ready.map((r) => r.id);
    expect(ids).toContain(t.id);
  }, 30_000);

  it('task with all blockers closed is ready', async () => {
    const blocker = await store.createTask('Blocker', 'p1');
    const blocked = await store.createTask('Blocked', 'p1');

    // blocked depends on blocker (blocker blocks blocked)
    await store.addDependency(blocked.contextId!, blocker.id, 'blocks');

    // Close the blocker
    await store.updateTask(blocker.id, { status: 'closed' });

    const ready = await engine.getReadyTasks();
    const ids = ready.map((r) => r.id);
    expect(ids).toContain(blocked.id);
  }, 30_000);

  it('task blocked by an open task is NOT ready', async () => {
    const blocker = await store.createTask('Open blocker', 'p1');
    const blocked = await store.createTask('Waiting', 'p1');

    await store.addDependency(blocked.contextId!, blocker.id, 'blocks');

    const ready = await engine.getReadyTasks();
    const ids = ready.map((r) => r.id);
    expect(ids).not.toContain(blocked.id);
  }, 30_000);

  it('transitive blocking: A blocked by B blocked by C (C open) → A not ready', async () => {
    const c = await store.createTask('Task C', 'p1');
    const b = await store.createTask('Task B', 'p1');
    const a = await store.createTask('Task A', 'p1');

    // B is blocked by C
    await store.addDependency(b.contextId!, c.id, 'blocks');
    // A is blocked by B
    await store.addDependency(a.contextId!, b.id, 'blocks');

    // B is not closed, so A is not ready
    const ready = await engine.getReadyTasks();
    const ids = ready.map((r) => r.id);
    expect(ids).not.toContain(a.id);
  }, 30_000);

  it('getReadyTasks returns empty when no open tasks exist', async () => {
    // Create a task and close it immediately
    const t = await store.createTask('Will close', 'p2', { collection: 'empty-test' });
    await store.updateTask(t.id, { status: 'closed' });

    // Filter to only this collection so we have a known set
    const ready = await engine.getReadyTasks({ collection: 'empty-test' });
    expect(ready).toEqual([]);
  }, 30_000);

  // -----------------------------------------------------------------------
  // detectCycle
  // -----------------------------------------------------------------------

  it('no cycle for a valid new dependency', async () => {
    const a = await store.createTask('Cycle-free A', 'p1');
    const b = await store.createTask('Cycle-free B', 'p1');

    // A is blocked by B — no cycle
    const result = await engine.detectCycle(a.id, b.id);
    expect(result).toBeNull();
  }, 30_000);

  it('detects direct cycle (A → B → A)', async () => {
    const a = await store.createTask('Direct cycle A', 'p1');
    const b = await store.createTask('Direct cycle B', 'p1');

    // A is blocked by B
    await store.addDependency(a.contextId!, b.id, 'blocks');

    // Now try to add: B is blocked by A → creates cycle
    const result = await engine.detectCycle(b.id, a.id);
    expect(result).not.toBeNull();
    expect(result!.length).toBeGreaterThanOrEqual(2);
    expect(result).toContain(a.id);
    expect(result).toContain(b.id);
  }, 30_000);

  it('detects transitive cycle (A → B → C → A)', async () => {
    const a = await store.createTask('Trans cycle A', 'p1');
    const b = await store.createTask('Trans cycle B', 'p1');
    const c = await store.createTask('Trans cycle C', 'p1');

    // A is blocked by B
    await store.addDependency(a.contextId!, b.id, 'blocks');
    // B is blocked by C
    await store.addDependency(b.contextId!, c.id, 'blocks');

    // Now try to add: C is blocked by A → creates cycle A → B → C → A
    const result = await engine.detectCycle(c.id, a.id);
    expect(result).not.toBeNull();
    expect(result!.length).toBeGreaterThanOrEqual(3);
    expect(result).toContain(a.id);
    expect(result).toContain(b.id);
    expect(result).toContain(c.id);
  }, 30_000);

  // -----------------------------------------------------------------------
  // getBlockers
  // -----------------------------------------------------------------------

  it('getBlockers returns direct blockers', async () => {
    const blocker = await store.createTask('Direct blocker', 'p1');
    const blocked = await store.createTask('Direct blocked', 'p1');

    await store.addDependency(blocked.contextId!, blocker.id, 'blocks');

    const blockers = await engine.getBlockers(blocked.id);
    const ids = blockers.map((r) => r.id);
    expect(ids).toContain(blocker.id);
  }, 30_000);

  it('getBlockers returns transitive blockers', async () => {
    const root = await store.createTask('Root blocker', 'p1');
    const mid = await store.createTask('Mid blocker', 'p1');
    const leaf = await store.createTask('Leaf blocked', 'p1');

    // leaf blocked by mid, mid blocked by root
    await store.addDependency(leaf.contextId!, mid.id, 'blocks');
    await store.addDependency(mid.contextId!, root.id, 'blocks');

    const blockers = await engine.getBlockers(leaf.id);
    const ids = blockers.map((r) => r.id);
    expect(ids).toContain(mid.id);
    expect(ids).toContain(root.id);
  }, 30_000);

  // -----------------------------------------------------------------------
  // getDependants
  // -----------------------------------------------------------------------

  it('getDependants returns tasks that depend on the given task', async () => {
    const blocker = await store.createTask('Dependant blocker', 'p1');
    const dep1 = await store.createTask('Dependant 1', 'p1');
    const dep2 = await store.createTask('Dependant 2', 'p1');

    // dep1 and dep2 are blocked by blocker
    await store.addDependency(dep1.contextId!, blocker.id, 'blocks');
    await store.addDependency(dep2.contextId!, blocker.id, 'blocks');

    const dependants = await engine.getDependants(blocker.id);
    const ids = dependants.map((r) => r.id);
    expect(ids).toContain(dep1.id);
    expect(ids).toContain(dep2.id);
  }, 30_000);

  // -----------------------------------------------------------------------
  // getSubtaskTree
  // -----------------------------------------------------------------------

  it('getSubtaskTree returns a tree with children', async () => {
    const parent = await store.createTask('Tree parent', 'p1');
    await store.createSubtask(parent.contextId!, 'Tree child A', 'p2');
    await store.createSubtask(parent.contextId!, 'Tree child B', 'p2');

    const tree: TaskTreeNode = await engine.getSubtaskTree(parent.id);

    expect(tree.task.id).toBe(parent.id);
    expect(tree.task.data.title).toBe('Tree parent');
    expect(tree.children.length).toBe(2);

    const childTitles = tree.children.map((c) => c.task.data.title);
    expect(childTitles).toContain('Tree child A');
    expect(childTitles).toContain('Tree child B');

    // Each child should have empty children array
    for (const child of tree.children) {
      expect(child.children).toEqual([]);
    }
  }, 30_000);
});
