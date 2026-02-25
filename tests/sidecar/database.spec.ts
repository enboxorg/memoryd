import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';

import { SidecarDatabase } from '../../src/sidecar/database.js';

// ---------------------------------------------------------------------------
// SidecarDatabase
// ---------------------------------------------------------------------------

describe('SidecarDatabase', () => {
  let sidecar: SidecarDatabase | undefined;
  let tempDir: string | undefined;

  afterEach(() => {
    sidecar?.close();
    sidecar = undefined;
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it('creates an in-memory database successfully', () => {
    sidecar = new SidecarDatabase(':memory:');
    expect(sidecar.db).toBeDefined();
  });

  it('exposes hasVectorSearch property', () => {
    sidecar = new SidecarDatabase(':memory:');
    expect(typeof sidecar.hasVectorSearch).toBe('boolean');
  });

  it('creates all expected tables', () => {
    sidecar = new SidecarDatabase(':memory:');

    const tables = sidecar.db
      .prepare(`SELECT name FROM sqlite_master WHERE type IN ('table', 'table') ORDER BY name`)
      .all() as Array<{ name: string }>;

    const tableNames = tables.map(t => t.name);

    // memory_embeddings only exists when sqlite-vec loaded
    if (sidecar.hasVectorSearch) {
      expect(tableNames).toContain('memory_embeddings');
    }
    expect(tableNames).toContain('memory_fts');
    expect(tableNames).toContain('task_graph');
    expect(tableNames).toContain('task_status');
    expect(tableNames).toContain('sync_state');
  });

  it('is idempotent — can be constructed twice on the same database', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'memoryd-test-'));
    const dbPath = join(tempDir, 'test.db');

    const first = new SidecarDatabase(dbPath);
    first.close();

    // Second construction on the same file should not throw.
    sidecar = new SidecarDatabase(dbPath);
    expect(sidecar.db).toBeDefined();
  });

  it('close works without error', () => {
    sidecar = new SidecarDatabase(':memory:');
    expect(() => sidecar!.close()).not.toThrow();
    sidecar = undefined; // Prevent double-close in afterEach
  });

  it('file-based database creates the file', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'memoryd-test-'));
    const dbPath = join(tempDir, 'index.db');

    expect(existsSync(dbPath)).toBe(false);
    sidecar = new SidecarDatabase(dbPath);
    expect(existsSync(dbPath)).toBe(true);
  });
});
