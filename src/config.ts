/**
 * Centralized runtime configuration — resolves env vars and defaults.
 *
 * All runtime settings are gathered here so that CLI commands and the
 * MCP server use a single source of truth.
 *
 * @module
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

import type { EmbeddingConfig } from './sidecar/embeddings.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Resolved runtime configuration. */
export type MemorydConfig = {
  /** Path to the sidecar SQLite database. */
  sidecarPath : string;
  /** Embedding provider configuration. */
  embedding : EmbeddingConfig;
  /** HTTP server host. */
  host : string;
  /** HTTP server port. */
  port : number;
};

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_SIDECAR_PATH = join(homedir(), '.memoryd', 'index.db');

// ---------------------------------------------------------------------------
// Resolve
// ---------------------------------------------------------------------------

/**
 * Build a {@link MemorydConfig} from environment variables and defaults.
 *
 * | Variable                      | Default                         |
 * |-------------------------------|---------------------------------|
 * | `MEMORYD_SIDECAR_PATH`        | `~/.memoryd/index.db`           |
 * | `MEMORYD_EMBEDDING_PROVIDER`  | `noop`                          |
 * | `MEMORYD_EMBEDDING_MODEL`     | provider default                |
 * | `MEMORYD_EMBEDDING_URL`       | `http://localhost:11434` (Ollama) |
 * | `MEMORYD_EMBEDDING_DIMENSIONS`| provider default                |
 * | `OPENAI_API_KEY`              | —                               |
 * | `MEMORYD_HOST`                | `localhost`                     |
 * | `MEMORYD_PORT`                | `3200`                          |
 */
export function resolveConfig(overrides?: Partial<MemorydConfig>): MemorydConfig {
  const provider = (
    process.env.MEMORYD_EMBEDDING_PROVIDER ?? 'noop'
  ) as EmbeddingConfig['provider'];

  const dimensionsRaw = process.env.MEMORYD_EMBEDDING_DIMENSIONS;
  const dimensions = dimensionsRaw ? Number(dimensionsRaw) : undefined;

  const portRaw = process.env.MEMORYD_PORT;
  const port = portRaw ? Number(portRaw) : 3200;

  return {
    sidecarPath: overrides?.sidecarPath
      ?? process.env.MEMORYD_SIDECAR_PATH
      ?? DEFAULT_SIDECAR_PATH,

    embedding: overrides?.embedding ?? {
      provider,
      model    : process.env.MEMORYD_EMBEDDING_MODEL,
      dimensions,
      endpoint : process.env.MEMORYD_EMBEDDING_URL,
      apiKey   : process.env.OPENAI_API_KEY,
    },

    host: overrides?.host
      ?? process.env.MEMORYD_HOST
      ?? 'localhost',

    port: overrides?.port ?? port,
  };
}
