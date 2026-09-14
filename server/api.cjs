'use strict';

/**
 * The HTTP face of the spot store.
 *
 * `createApi` returns an Express app rather than starting a server, because an
 * Express app is also a plain connect middleware. That is what lets the same
 * code mount inside the Vite dev server, sit behind the static file handler in
 * a web deploy, and run on a loopback port under Electron, without three
 * versions of it.
 */

const express = require('express');
const spots = require('./spots.cjs');

/**
 * @param db          an open handle from `openDb`
 * @param allowOrigin origin to answer CORS for, when the page is not served
 *                    from this server. Only the desktop build needs it.
 */
function createApi(db, { allowOrigin = null } = {}) {
  const api = express();
  api.disable('x-powered-by');

  if (allowOrigin) {
    api.use((req, res, next) => {
      if (req.headers.origin !== allowOrigin) return next();
      res.setHeader('Access-Control-Allow-Origin', allowOrigin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Vary', 'Origin');
      if (req.method === 'OPTIONS') return res.status(204).end();
      return next();
    });
  }

  // A spot is four small fields; anything larger is not one.
  api.use(express.json({ limit: '8kb' }));

  api.get('/api/spots', (_req, res) => {
    res.json(spots.listSpots(db));
  });

  api.post('/api/spots', (req, res) => {
    res.status(201).json(spots.createSpot(db, req.body));
  });

  api.patch('/api/spots/:id', (req, res) => {
    res.json(spots.renameSpot(db, req.params.id, req.body));
  });

  api.delete('/api/spots/:id', (req, res) => {
    spots.deleteSpot(db, req.params.id);
    res.status(204).end();
  });

  // Express routes sync throws here, which is how SpotError reaches the client.
  // The four-argument signature is what marks this as the error handler, so the
  // unused `next` has to stay.
  // eslint-disable-next-line no-unused-vars
  api.use((err, _req, res, _next) => {
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Malformed JSON.' });
    }
    const status = Number.isInteger(err?.status) && err.status < 500 ? err.status : 500;
    if (status === 500) console.error('[tideline/api]', err);
    // A 500 is our bug, not the user's; it should not leak its details.
    return res.status(status).json({ error: status === 500 ? 'Internal error.' : err.message });
  });

  return api;
}

module.exports = { createApi };
