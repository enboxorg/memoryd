import type { TaskRecord, TaskStore } from './task-store.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaskTreeNode = {
  task : TaskRecord;
  children : TaskTreeNode[];
};

/**
 * Adjacency list: taskId → list of taskIds.
 */
type AdjacencyList = Map<string, string[]>;

type GraphData = {
  tasks : Map<string, TaskRecord>;
  blockedBy : AdjacencyList; // taskId → [taskIds that block it]
  blockers : AdjacencyList; // taskId → [taskIds it blocks] (reverse)
};

// ---------------------------------------------------------------------------
// GraphEngine
// ---------------------------------------------------------------------------

export class GraphEngine {
  constructor(private readonly taskStore: TaskStore) {}

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Build the full graph by loading every task and its blocking dependencies.
   */
  private async buildGraph(): Promise<GraphData> {
    const tasks: Map<string, TaskRecord> = new Map();
    const blockedBy: AdjacencyList = new Map();
    const blockers: AdjacencyList = new Map();

    // 1. Paginate through all tasks
    let cursor: Awaited<ReturnType<TaskStore['listTasks']>>['cursor'];
    do {
      const page = await this.taskStore.listTasks(undefined, cursor ? { cursor } : undefined);
      for (const task of page.records) {
        tasks.set(task.id, task);
      }
      cursor = page.cursor;
    } while (cursor !== undefined);

    // 2. For each task, fetch detail and build adjacency lists
    for (const task of tasks.values()) {
      const detail = await this.taskStore.getTask(task.id);

      for (const dep of detail.dependencies) {
        if (dep.tags.type !== 'blocks') {
          continue;
        }

        const targetId = dep.tags.targetId;

        // task has a dependency with type 'blocks' and targetId → targetId blocks task
        // So: blockedBy[task.id] includes targetId
        const bb = blockedBy.get(task.id) ?? [];
        bb.push(targetId);
        blockedBy.set(task.id, bb);

        // Reverse: blockers[targetId] includes task.id
        const bl = blockers.get(targetId) ?? [];
        bl.push(task.id);
        blockers.set(targetId, bl);
      }
    }

    return { tasks, blockedBy, blockers };
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Returns all open tasks whose blocking dependencies are all closed.
   * A task with no blockers is considered ready.
   */
  async getReadyTasks(
    filters?: { collection?: string; priority?: string },
  ): Promise<TaskRecord[]> {
    const { tasks, blockedBy } = await this.buildGraph();

    const ready: TaskRecord[] = [];

    for (const task of tasks.values()) {
      if (task.tags.status !== 'open') {
        continue;
      }

      const blockerIds = blockedBy.get(task.id) ?? [];
      const allBlockersClosed = blockerIds.every((id) => {
        const blocker = tasks.get(id);
        return blocker !== undefined && blocker.tags.status === 'closed';
      });

      if (!allBlockersClosed) {
        continue;
      }

      // Apply optional filters
      if (filters?.collection !== undefined && task.tags.collection !== filters.collection) {
        continue;
      }
      if (filters?.priority !== undefined && task.tags.priority !== filters.priority) {
        continue;
      }

      ready.push(task);
    }

    return ready;
  }

  /**
   * Check whether adding a dependency (taskId depends on newDependencyTargetId)
   * would create a cycle. Returns the cycle path if one exists, null otherwise.
   */
  async detectCycle(
    taskId: string,
    newDependencyTargetId: string,
  ): Promise<string[] | null> {
    const { blockedBy } = await this.buildGraph();

    // Temporarily add the new edge: taskId is blocked by newDependencyTargetId
    const existing = blockedBy.get(taskId) ?? [];
    blockedBy.set(taskId, [...existing, newDependencyTargetId]);

    // DFS from newDependencyTargetId following blockedBy edges.
    // If we reach taskId, there is a cycle.
    const visited = new Set<string>();
    const path: string[] = [];

    const dfs = (current: string): boolean => {
      if (current === taskId) {
        path.push(current);
        return true;
      }
      if (visited.has(current)) {
        return false;
      }
      visited.add(current);
      path.push(current);

      const neighbors = blockedBy.get(current) ?? [];
      for (const neighbor of neighbors) {
        if (dfs(neighbor)) {
          return true;
        }
      }

      path.pop();
      return false;
    };

    if (dfs(newDependencyTargetId)) {
      return path;
    }

    return null;
  }

  /**
   * Returns the transitive closure of all tasks that block the given task
   * (direct and indirect). BFS following blockedBy edges.
   */
  async getBlockers(taskId: string): Promise<TaskRecord[]> {
    const { tasks, blockedBy } = await this.buildGraph();

    const visited = new Set<string>();
    const queue: string[] = [...(blockedBy.get(taskId) ?? [])];
    const result: TaskRecord[] = [];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) {
        continue;
      }
      visited.add(current);

      const task = tasks.get(current);
      if (task !== undefined) {
        result.push(task);
      }

      const neighbors = blockedBy.get(current) ?? [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          queue.push(neighbor);
        }
      }
    }

    return result;
  }

  /**
   * Returns all tasks that depend on the given task (direct and indirect).
   * BFS following the reverse graph (blockers edges).
   */
  async getDependants(taskId: string): Promise<TaskRecord[]> {
    const { tasks, blockers } = await this.buildGraph();

    const visited = new Set<string>();
    const queue: string[] = [...(blockers.get(taskId) ?? [])];
    const result: TaskRecord[] = [];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) {
        continue;
      }
      visited.add(current);

      const task = tasks.get(current);
      if (task !== undefined) {
        result.push(task);
      }

      const neighbors = blockers.get(current) ?? [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          queue.push(neighbor);
        }
      }
    }

    return result;
  }

  /**
   * Returns a recursive tree of subtasks for the given task.
   *
   * Calls `TaskStore.getTask` on the root task to obtain its subtask list,
   * then converts each subtask into a leaf `TaskTreeNode`.  Because the DWN
   * protocol stores subtasks at nested paths (`task/task`, `task/task/task`),
   * and `TaskStore.getTask` can only read top-level `task` records, deeper
   * nesting is not recursively expanded via `getTask`.  Instead, subtasks
   * returned by the parent's detail are always represented as leaf nodes.
   */
  async getSubtaskTree(taskId: string): Promise<TaskTreeNode> {
    const detail = await this.taskStore.getTask(taskId);

    const children: TaskTreeNode[] = detail.subtasks.map((subtask) => ({
      task     : subtask,
      children : [] as TaskTreeNode[],
    }));

    return {
      task: {
        id          : detail.id,
        contextId   : detail.contextId,
        data        : detail.data,
        tags        : detail.tags,
        dateCreated : detail.dateCreated,
      },
      children,
    };
  }
}
