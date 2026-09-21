import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * The spot store.
 *
 * `node:sqlite` is built into Node, so there is no driver to install and
 * nothing to compile. It is also entirely synchronous, which is why everything
 * above it can be.
 *
 * This is a staging post. Phase B replaces it with MongoDB, at which point the
 * `getDb` caching below becomes the connection-reuse the serverless runtime
 * needs — same shape, different driver.
 */

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS spots (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    lat        REAL    NOT NULL,
    lon        REAL    NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE (lat, lon)
  );
`;

/**
 * Opens the database at `file`, creating it and its directory if needed.
 * Pass ':memory:' for a throwaway one.
 */
export function openDb(file: string): DatabaseSync {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });

  const db = new DatabaseSync(file);
  // A crash mid-write should cost the last save, never the whole library.
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec(SCHEMA);
  return db;
}

/**
 * Read when the handle is opened rather than when the module is, so a test can
 * point TIDELINE_DB at ':memory:' without having to control import order.
 */
function dbFile(): string {
  return process.env.TIDELINE_DB ?? path.join(process.cwd(), '.data', 'spots.db');
}

/**
 * The one handle the route handlers share.
 *
 * Module scope is not far enough: `next dev` re-evaluates a route module on
 * every edit, and a second `DatabaseSync` over the same file takes its own WAL
 * lock and deadlocks against the first. `globalThis` outlives those reloads,
 * so the handle is opened once per process however many times this module is.
 */
const cache = globalThis as typeof globalThis & { __tidelineDb?: DatabaseSync };

export function getDb(): DatabaseSync {
  return (cache.__tidelineDb ??= openDb(dbFile()));
}
