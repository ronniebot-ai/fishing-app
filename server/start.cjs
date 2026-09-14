'use strict';

/**
 * Standalone server: the API, plus the built web app when there is one.
 *
 * `npm run build && npm run serve` gives the whole thing on one origin, which
 * is why the client can use relative URLs everywhere except the desktop build.
 */

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { openDb } = require('./db.cjs');
const { createApi } = require('./api.cjs');

const PORT = Number(process.env.PORT ?? 4317);
const DB_FILE = process.env.TIDELINE_DB ?? path.join(__dirname, 'data', 'spots.db');
const WEB_DIR = path.join(__dirname, '..', 'dist');

const app = express();
app.use(createApi(openDb(DB_FILE)));

if (fs.existsSync(path.join(WEB_DIR, 'index.html'))) {
  app.use(express.static(WEB_DIR));
  // One page, so any GET that matched no file is still that page — a shared
  // ?lat=&lon= link has to open even on a hard load.
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    return res.sendFile(path.join(WEB_DIR, 'index.html'));
  });
} else {
  console.log('No dist/ build found — serving the API only. Run `npm run build` first.');
}

app.listen(PORT, () => {
  console.log(`Tideline on http://localhost:${PORT}`);
  console.log(`Spots in ${DB_FILE}`);
});
