// memoryd vector sidecar — barrel export for @enbox/memoryd/sidecar.

export type { EmbeddingConfig, EmbeddingProvider } from './embeddings.js';
export { createEmbeddingProvider, NoopProvider, OllamaProvider, OpenAIProvider } from './embeddings.js';

export { SidecarDatabase } from './database.js';

export { SearchIndex } from './search.js';
export type { IndexRecord, SearchFilters, SearchResult } from './search.js';
