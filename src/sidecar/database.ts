// ---------------------------------------------------------------------------
// SidecarDatabase — SQLite lifecycle management for the vector sidecar.
// ---------------------------------------------------------------------------

import { Database } from 'bun:sqlite';

export class SidecarDatabase {
  readonly db: Database;

  /**
   * Whether the sqlite-vec extension loaded successfully.
   * When `false`, the sidecar operates in FTS-only mode —
   * keyword search still works, but vector KNN is unavailable.
   */
  readonly hasVectorSearch: boolean;

  constructor(dbPath: string, dimensions: number = 768) {
    this.db = new Database(dbPath);
    this.hasVectorSearch = this.tryLoadVec();
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.createTables(dimensions);
  }

  /**
   * Attempt to load the sqlite-vec extension.
   * Returns `true` on success, `false` when the extension cannot load
   * (e.g. the SQLite build lacks dynamic extension loading).
   */
  private tryLoadVec(): boolean {
    try {

      const sqliteVec = require('sqlite-vec') as { load: (db: Database) => void };
      sqliteVec.load(this.db);
      return true;
    } catch {
      return false;
    }
  }

  private createTables(dimensions: number): void {
    // Vector search (sqlite-vec) — only when the extension loaded.
    if (this.hasVectorSearch) {
      // vec0 does not support IF NOT EXISTS; use try/catch for idempotency.
      try {
        this.db.exec(`
          CREATE VIRTUAL TABLE memory_embeddings USING vec0(
            embedding float[${dimensions}],
            +record_id TEXT NOT NULL,
            +protocol_path TEXT NOT NULL,
            +content_preview TEXT,
            +category TEXT,
            +collection TEXT,
            +updated_at TEXT NOT NULL
          );
        `);
      } catch (e: unknown) {
        // Table already exists — safe to ignore.
        if (!(e instanceof Error) || !e.message.includes('already exists')) {
          throw e;
        }
      }
    }

    // Full-text search (FTS5)
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        content,
        record_id UNINDEXED,
        protocol_path UNINDEXED,
        category UNINDEXED,
        collection UNINDEXED
      );
    `);

    // Task graph cache
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS task_graph (
        task_id TEXT NOT NULL,
        depends_on TEXT NOT NULL,
        dep_type TEXT NOT NULL,
        PRIMARY KEY (task_id, depends_on)
      );
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS task_status (
        task_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        priority TEXT,
        assignee TEXT,
        title TEXT,
        record_id TEXT NOT NULL
      );
    `);

    // Sync tracking
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sync_state (
        protocol TEXT PRIMARY KEY,
        cursor TEXT,
        last_sync TEXT NOT NULL
      );
    `);
  }

  close(): void {
    this.db.close();
  }
}
