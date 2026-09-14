/**
 * The API over a real socket. The store's rules are pinned down in
 * spots.test.js; what matters here is the translation — which status code each
 * outcome becomes, that an error carries a message the UI can show, and that
 * the desktop build's cross-origin requests are actually answered.
 */
import { createServer } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from './db.cjs';
import { createApi } from './api.cjs';

const BONDI = { lat: -33.8908, lon: 151.2743 };
const DESKTOP_ORIGIN = 'app://tideline';

let server;
let base;

/** Boots the API on an ephemeral port so the suite never picks a fight over one. */
function listen(options) {
  return new Promise((resolve) => {
    const http = createServer(createApi(openDb(':memory:'), options));
    http.listen(0, '127.0.0.1', () => {
      const { port } = http.address();
      resolve([http, `http://127.0.0.1:${port}`]);
    });
  });
}

async function call(method, path, body, headers) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, headers: res.headers, body: res.status === 204 ? null : await res.json() };
}

beforeEach(async () => {
  [server, base] = await listen();
});

afterEach(() => {
  server.close();
});

describe('GET /api/spots', () => {
  it('starts empty', async () => {
    expect(await call('GET', '/api/spots')).toMatchObject({ status: 200, body: [] });
  });
});

describe('POST /api/spots', () => {
  it('creates with 201 and returns the saved spot', async () => {
    const res = await call('POST', '/api/spots', BONDI);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: 1, name: 'Spot 1', ...BONDI });
  });

  it('409s on a spot already saved, saying which one it is', async () => {
    await call('POST', '/api/spots', { ...BONDI, name: 'The wall' });
    const res = await call('POST', '/api/spots', BONDI);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/The wall/);
  });

  it('400s on coordinates that are not on the planet', async () => {
    expect(await call('POST', '/api/spots', { lat: 900, lon: 0 })).toMatchObject({ status: 400 });
  });

  it('400s on a body that is not JSON', async () => {
    const res = await fetch(`${base}/api/spots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Malformed JSON.');
  });

  it('400s rather than 500s when there is no body at all', async () => {
    expect(await call('POST', '/api/spots')).toMatchObject({ status: 400 });
  });
});

describe('PATCH /api/spots/:id', () => {
  it('renames and returns the spot', async () => {
    await call('POST', '/api/spots', BONDI);
    const res = await call('PATCH', '/api/spots/1', { name: 'The wall' });

    expect(res).toMatchObject({ status: 200, body: { id: 1, name: 'The wall' } });
  });

  it('404s on an id that was never saved', async () => {
    expect(await call('PATCH', '/api/spots/7', { name: 'x' })).toMatchObject({ status: 404 });
  });

  it('400s on an id that is not a number', async () => {
    expect(await call('PATCH', '/api/spots/abc', { name: 'x' })).toMatchObject({ status: 400 });
  });
});

describe('DELETE /api/spots/:id', () => {
  it('deletes with 204 and no body', async () => {
    await call('POST', '/api/spots', BONDI);

    expect(await call('DELETE', '/api/spots/1')).toMatchObject({ status: 204 });
    expect((await call('GET', '/api/spots')).body).toEqual([]);
  });

  it('404s on an id that was never saved', async () => {
    expect(await call('DELETE', '/api/spots/7')).toMatchObject({ status: 404 });
  });
});

describe('cross-origin access', () => {
  it('is off by default, which is all a same-origin deploy needs', async () => {
    const res = await call('GET', '/api/spots', undefined, { Origin: DESKTOP_ORIGIN });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  describe('when an origin is allowed', () => {
    beforeEach(async () => {
      server.close();
      [server, base] = await listen({ allowOrigin: DESKTOP_ORIGIN });
    });

    it('answers the preflight a PATCH from the desktop build triggers', async () => {
      const res = await fetch(`${base}/api/spots/1`, {
        method: 'OPTIONS',
        headers: {
          Origin: DESKTOP_ORIGIN,
          'Access-Control-Request-Method': 'PATCH',
          'Access-Control-Request-Headers': 'content-type',
        },
      });

      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-origin')).toBe(DESKTOP_ORIGIN);
      expect(res.headers.get('access-control-allow-methods')).toMatch(/PATCH/);
    });

    it('lets that origin read the list', async () => {
      const res = await call('GET', '/api/spots', undefined, { Origin: DESKTOP_ORIGIN });
      expect(res.headers.get('access-control-allow-origin')).toBe(DESKTOP_ORIGIN);
    });

    it('does not answer for any other origin', async () => {
      const res = await call('GET', '/api/spots', undefined, { Origin: 'https://example.com' });
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });
  });
});
