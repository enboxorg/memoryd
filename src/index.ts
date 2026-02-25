// memoryd — User-owned AI memory layer with task graph, built on DWN protocols.
// This is the barrel export for the @enbox/memoryd package.

export { MemoryProtocol } from './protocols/memory.js';
export type { CollectionData, FactData, PreferenceData, RelationshipData, SupersessionData } from './protocols/memory.js';

export { TaskGraphProtocol } from './protocols/task-graph.js';
export type { DependencyData, NoteData, StatusChangeData, TaskData } from './protocols/task-graph.js';

export { AuditProtocol } from './protocols/audit.js';
export type { ActionLogData } from './protocols/audit.js';

export { MemoryStore } from './core/memory-store.js';
export type {
  FactFilters,
  FactRecord,
  ListResult,
  PaginationOptions,
  PreferenceFilters,
  PreferenceRecord,
  RecordResult,
  RelationshipFilters,
  RelationshipRecord,
} from './core/memory-store.js';

export { TaskStore } from './core/task-store.js';
export type {
  DependencyRecord,
  NoteRecord,
  StatusChangeRecord,
  TaskDetail,
  TaskFilters,
  TaskListResult,
  TaskRecord,
  TaskResult,
} from './core/task-store.js';

export { GraphEngine } from './core/graph.js';
export type { TaskTreeNode } from './core/graph.js';

export type { EmbeddingConfig, EmbeddingProvider } from './sidecar/embeddings.js';
export { createEmbeddingProvider, NoopProvider, OllamaProvider, OpenAIProvider } from './sidecar/embeddings.js';
