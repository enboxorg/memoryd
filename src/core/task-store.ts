import type { DwnPaginationCursor } from '@enbox/agent';
import type { Web5 } from '@enbox/api';

import { DateSort } from '@enbox/dwn-sdk-js';

import { TaskGraphProtocol } from '../protocols/task-graph.js';
import type { DependencyData, NoteData, StatusChangeData, TaskData } from '../protocols/task-graph.js';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type TaskResult = {
  id : string;
  contextId : string | undefined;
  status : { code: number; detail: string };
};

export type TaskRecord = {
  id : string;
  contextId : string | undefined;
  data : TaskData;
  tags : {
    status : string;
    priority : string;
    type? : string;
    assignee? : string;
    collection? : string;
  };
  dateCreated : string;
};

export type TaskDetail = TaskRecord & {
  subtasks : TaskRecord[];
  dependencies : DependencyRecord[];
  statusHistory : StatusChangeRecord[];
  notes : NoteRecord[];
};

export type DependencyRecord = {
  id : string;
  data : DependencyData;
  tags : { type: string; targetId: string };
};

export type StatusChangeRecord = {
  id : string;
  data : StatusChangeData;
  tags : { from: string; to: string; reason?: string };
  dateCreated : string;
};

export type NoteRecord = {
  id : string;
  data : NoteData;
  dateCreated : string;
};

export type TaskFilters = {
  status? : string;
  priority? : string;
  type? : string;
  assignee? : string;
  collection? : string;
};

export type TaskListResult = {
  records : TaskRecord[];
  cursor? : DwnPaginationCursor;
};

export type PaginationOptions = {
  limit? : number;
  cursor? : DwnPaginationCursor;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type TagFilter = Record<string, string>;

function buildTagFilter(filters?: TaskFilters): TagFilter | undefined {
  if (!filters) {
    return undefined;
  }
  const tags: TagFilter = {};
  if (filters.status !== undefined) { tags.status = filters.status; }
  if (filters.priority !== undefined) { tags.priority = filters.priority; }
  if (filters.type !== undefined) { tags.type = filters.type; }
  if (filters.assignee !== undefined) { tags.assignee = filters.assignee; }
  if (filters.collection !== undefined) { tags.collection = filters.collection; }
  return Object.keys(tags).length > 0 ? tags : undefined;
}

function extractTaskTags(
  raw: Record<string, unknown> | undefined,
): TaskRecord['tags'] {
  const t = raw ?? {};
  return {
    status   : t.status as string,
    priority : t.priority as string,
    ...(t.type !== undefined ? { type: t.type as string } : {}),
    ...(t.assignee !== undefined ? { assignee: t.assignee as string } : {}),
    ...(t.collection !== undefined ? { collection: t.collection as string } : {}),
  };
}

// ---------------------------------------------------------------------------
// TaskStore
// ---------------------------------------------------------------------------

export class TaskStore {
  private readonly typed;
  private configurePromise: Promise<void> | undefined;

  constructor(private readonly web5: Web5) {
    this.typed = web5.using(TaskGraphProtocol);
  }

  private ensureConfigured(): Promise<void> {
    if (!this.configurePromise) {
      this.configurePromise = this.typed.configure({ encryption: true }).then(() => undefined);
    }
    return this.configurePromise;
  }

  // -----------------------------------------------------------------------
  // Task CRUD
  // -----------------------------------------------------------------------

  async createTask(
    title: string,
    priority: string,
    opts?: {
      description? : string;
      type? : string;
      assignee? : string;
      collection? : string;
    },
  ): Promise<TaskResult> {
    await this.ensureConfigured();

    const tags: Record<string, string> = { status: 'open', priority };
    if (opts?.type !== undefined) { tags.type = opts.type; }
    if (opts?.assignee !== undefined) { tags.assignee = opts.assignee; }
    if (opts?.collection !== undefined) { tags.collection = opts.collection; }

    const data: TaskData = { title };
    if (opts?.description !== undefined) { data.description = opts.description; }

    const { record, status } = await this.typed.records.create('task', {
      data,
      tags,
      encryption: true,
    });

    return { id: record.id, contextId: record.contextId, status };
  }

  async createSubtask(
    parentContextId: string,
    title: string,
    priority: string,
    opts?: {
      description? : string;
      type? : string;
      assignee? : string;
      collection? : string;
    },
  ): Promise<TaskResult> {
    await this.ensureConfigured();

    const tags: Record<string, string> = { status: 'open', priority };
    if (opts?.type !== undefined) { tags.type = opts.type; }
    if (opts?.assignee !== undefined) { tags.assignee = opts.assignee; }
    if (opts?.collection !== undefined) { tags.collection = opts.collection; }

    const data: TaskData = { title };
    if (opts?.description !== undefined) { data.description = opts.description; }

    const { record, status } = await this.typed.records.create('task/task', {
      data,
      tags,
      parentContextId,
      encryption: true,
    });

    return { id: record.id, contextId: record.contextId, status };
  }

  async updateTask(
    recordId: string,
    updates: {
      title? : string;
      description? : string;
      status? : string;
      priority? : string;
      type? : string;
      assignee? : string;
    },
  ): Promise<TaskResult> {
    await this.ensureConfigured();

    const { record: existing } = await this.typed.records.read('task', {
      filter     : { recordId },
      encryption : true,
    });

    const currentData = await existing.data.json();
    const currentTags = (existing.tags ?? {}) as Record<string, string>;

    const newData: TaskData = {
      title       : updates.title ?? currentData.title,
      description : updates.description ?? currentData.description,
    };

    const newTags: Record<string, string> = { ...currentTags };
    if (updates.status !== undefined) { newTags.status = updates.status; }
    if (updates.priority !== undefined) { newTags.priority = updates.priority; }
    if (updates.type !== undefined) { newTags.type = updates.type; }
    if (updates.assignee !== undefined) { newTags.assignee = updates.assignee; }

    const { status } = await existing.update({ data: newData, tags: newTags });

    // If status changed, write a statusChange sub-record
    if (updates.status !== undefined && updates.status !== currentTags.status) {
      const scTags: Record<string, string> = {
        from : currentTags.status,
        to   : updates.status,
      };

      await this.typed.records.create('task/statusChange', {
        data            : {} as StatusChangeData,
        tags            : scTags,
        parentContextId : existing.contextId!,
      });
    }

    return { id: existing.id, contextId: existing.contextId, status };
  }

  async claimTask(recordId: string, assignee: string): Promise<TaskResult> {
    await this.ensureConfigured();

    const { record: existing } = await this.typed.records.read('task', {
      filter     : { recordId },
      encryption : true,
    });

    const currentData = await existing.data.json();
    const currentTags = (existing.tags ?? {}) as Record<string, string>;
    const previousStatus = currentTags.status;

    const newTags: Record<string, string> = {
      ...currentTags,
      status: 'in_progress',
      assignee,
    };

    const { status } = await existing.update({ data: currentData, tags: newTags });

    // Write statusChange record
    if (previousStatus !== 'in_progress') {
      const scTags: Record<string, string> = {
        from : previousStatus,
        to   : 'in_progress',
      };

      await this.typed.records.create('task/statusChange', {
        data            : {} as StatusChangeData,
        tags            : scTags,
        parentContextId : existing.contextId!,
      });
    }

    return { id: existing.id, contextId: existing.contextId, status };
  }

  async addDependency(
    taskContextId: string,
    dependsOnTaskId: string,
    type: string,
    opts?: { description?: string },
  ): Promise<void> {
    await this.ensureConfigured();

    const data: DependencyData = {};
    if (opts?.description !== undefined) { data.description = opts.description; }

    await this.typed.records.create('task/dependency', {
      data,
      tags            : { type, targetId: dependsOnTaskId },
      parentContextId : taskContextId,
    });
  }

  async addNote(taskContextId: string, content: string): Promise<void> {
    await this.ensureConfigured();

    await this.typed.records.create('task/note', {
      data            : { content } as NoteData,
      parentContextId : taskContextId,
    });
  }

  async getTask(recordId: string): Promise<TaskDetail> {
    await this.ensureConfigured();

    const { record } = await this.typed.records.read('task', {
      filter     : { recordId },
      encryption : true,
    });

    const data = await record.data.json();
    const tags = extractTaskTags(record.tags as Record<string, unknown> | undefined);

    // Query nested records in parallel
    const [subtaskRes, depRes, scRes, noteRes] = await Promise.all([
      this.typed.records.query('task/task', {
        filter     : { contextId: record.contextId },
        dateSort   : DateSort.CreatedDescending,
        encryption : true,
      }),
      this.typed.records.query('task/dependency', {
        filter   : { contextId: record.contextId },
        dateSort : DateSort.CreatedDescending,
      }),
      this.typed.records.query('task/statusChange', {
        filter   : { contextId: record.contextId },
        dateSort : DateSort.CreatedDescending,
      }),
      this.typed.records.query('task/note', {
        filter   : { contextId: record.contextId },
        dateSort : DateSort.CreatedDescending,
      }),
    ]);

    const subtasks: TaskRecord[] = await Promise.all(
      subtaskRes.records.map(async (r) => {
        const d = await r.data.json();
        return {
          id          : r.id,
          contextId   : r.contextId,
          data        : d,
          tags        : extractTaskTags(r.tags as Record<string, unknown> | undefined),
          dateCreated : r.dateCreated,
        };
      }),
    );

    const dependencies: DependencyRecord[] = await Promise.all(
      depRes.records.map(async (r) => {
        const d = await r.data.json();
        const rt = (r.tags ?? {}) as Record<string, string>;
        return {
          id   : r.id,
          data : d,
          tags : { type: rt.type, targetId: rt.targetId },
        };
      }),
    );

    const statusHistory: StatusChangeRecord[] = await Promise.all(
      scRes.records.map(async (r) => {
        const d = await r.data.json();
        const rt = (r.tags ?? {}) as Record<string, string>;
        return {
          id   : r.id,
          data : d,
          tags : {
            from : rt.from,
            to   : rt.to,
            ...(rt.reason !== undefined ? { reason: rt.reason } : {}),
          },
          dateCreated: r.dateCreated,
        };
      }),
    );

    const notes: NoteRecord[] = await Promise.all(
      noteRes.records.map(async (r) => {
        const d = await r.data.json();
        return {
          id          : r.id,
          data        : d,
          dateCreated : r.dateCreated,
        };
      }),
    );

    return {
      id          : record.id,
      contextId   : record.contextId,
      data,
      tags,
      dateCreated : record.dateCreated,
      subtasks,
      dependencies,
      statusHistory,
      notes,
    };
  }

  async listTasks(
    filters?: TaskFilters,
    pagination?: PaginationOptions,
  ): Promise<TaskListResult> {
    await this.ensureConfigured();

    const tagFilter = buildTagFilter(filters);

    const { records, cursor } = await this.typed.records.query('task', {
      filter     : tagFilter ? { tags: tagFilter } : undefined,
      dateSort   : DateSort.CreatedDescending,
      encryption : true,
      ...(pagination ? { pagination: { limit: pagination.limit, cursor: pagination.cursor } } : {}),
    });

    const mapped: TaskRecord[] = await Promise.all(
      records.map(async (r) => {
        const d = await r.data.json();
        return {
          id          : r.id,
          contextId   : r.contextId,
          data        : d,
          tags        : extractTaskTags(r.tags as Record<string, unknown> | undefined),
          dateCreated : r.dateCreated,
        };
      }),
    );

    return { records: mapped, cursor };
  }

  async deleteTask(recordId: string): Promise<void> {
    await this.ensureConfigured();

    await this.typed.records.delete('task', { recordId });
  }
}
