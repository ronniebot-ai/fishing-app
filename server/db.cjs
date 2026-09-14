'use strict';

/**
 * The spot store.
 *
 * `node:sqlite` is built into Node 24, which is what the dev server, the CI
 * runner and Electron's main process all run. Using it instead of a native
 * binding keeps the desktop build free of a rebuild step: there is nothing to
 * compile against Electron's ABI and nothing to unpack from the asar.
 */

const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

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
function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });

  const db = new DatabaseSync(file);
  // A crash mid-write should cost the last save, never the whole library.
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec(SCHEMA);
  return db;
}

module.exports = { openDb };
