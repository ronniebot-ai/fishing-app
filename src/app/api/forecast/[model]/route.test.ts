/**
 * The Open-Meteo proxy.
 *
 * Two things are worth pinning down here and neither is the happy path. One is
 * that it is not an open proxy: the model is a fixed choice, the coordinates
 * are checked, and anything not on the allow list is dropped rather than
 * forwarded. The other is that only a good answer is allowed to be cached — an
 * error held at the edge for fifteen minutes is fifteen minutes of a broken
 * app.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

const ORIGIN = 'http://tideline.test';
const BODY = { hourly: { time: ['2026-09-22T00:00'], wave_height: [0.8] } };

let upstream: ReturnType<typeof vi.fn>;

beforeEach(() => {
  upstream = vi.fn(async () => Response.json(BODY));
  vi.stubGlobal('fetch', upstream);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function call(model: string, query: string) {
  return GET(new Request(`${ORIGIN}/api/forecast/${model}?${query}`), {
    params: Promise.resolve({ model }),
  });
}

/** The URL the proxy asked Open-Meteo for. */
function asked(): URL {
  return new URL(upstream.mock.calls[0][0] as string);
}

describe('GET /api/forecast/:model', () => {
  it('passes a marine request through and hands back what came out', async () => {
    const res = await call('marine', 'latitude=-33.89&longitude=151.27&hourly=wave_height');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(BODY);
    expect(asked().origin).toBe('https://marine-api.open-meteo.com');
  });

  it('sends the atmospheric model to the other host', async () => {
    await call('forecast', 'latitude=-33.89&longitude=151.27&wind_speed_unit=kn');
    expect(asked().origin).toBe('https://api.open-meteo.com');
  });

  it('takes the batched form the ocean snap uses', async () => {
    const lat = Array.from({ length: 25 }, (_, i) => -33.8 - i * 0.08).join(',');
    const lon = Array.from({ length: 25 }, (_, i) => 151.2 + i * 0.08).join(',');

    const res = await call('marine', `latitude=${lat}&longitude=${lon}&hourly=wave_height`);

    expect(res.status).toBe(200);
    expect(asked().searchParams.get('latitude')?.split(',')).toHaveLength(25);
  });

  it('lets a good answer be cached at the edge', async () => {
    const res = await call('marine', 'latitude=-33.89&longitude=151.27');
    expect(res.headers.get('cache-control')).toMatch(/s-maxage=900/);
  });

  it('refuses to cache an answer Open-Meteo refused', async () => {
    // Fifteen minutes of a cached error is fifteen minutes of a broken app.
    upstream.mockResolvedValueOnce(
      Response.json({ error: true, reason: 'No data' }, { status: 400 }),
    );

    const res = await call('marine', 'latitude=-33.89&longitude=151.27');

    expect(res.status).toBe(400);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toMatchObject({ reason: 'No data' });
  });

  it('answers 502 when Open-Meteo cannot be reached at all', async () => {
    upstream.mockRejectedValueOnce(new Error('network down'));

    const res = await call('marine', 'latitude=-33.89&longitude=151.27');

    expect(res.status).toBe(502);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('drops parameters it was not asked to forward', async () => {
    // Otherwise this is an open proxy with a cache in front of it, and the
    // cache key is whatever a stranger types.
    await call('marine', 'latitude=-33.89&longitude=151.27&models=evil&apikey=leak');

    expect(asked().searchParams.get('models')).toBeNull();
    expect(asked().searchParams.get('apikey')).toBeNull();
    expect(asked().searchParams.get('latitude')).toBe('-33.89');
  });

  it('builds the upstream query in a fixed order, whatever order it arrived in', async () => {
    await call('forecast', 'wind_speed_unit=kn&longitude=151.27&latitude=-33.89');

    expect([...asked().searchParams.keys()]).toEqual([
      'latitude',
      'longitude',
      'wind_speed_unit',
    ]);
  });

  it.each([
    ['a model that is not one of ours', 'weather', 'latitude=-33.89&longitude=151.27'],
    ['no coordinates at all', 'marine', 'hourly=wave_height'],
    ['a latitude with no longitude', 'marine', 'latitude=-33.89'],
    ['lists that do not pair up', 'marine', 'latitude=-33.89,-33.7&longitude=151.27'],
    ['a latitude past the pole', 'marine', 'latitude=91&longitude=151.27'],
    ['a longitude past the date line', 'marine', 'latitude=-33.89&longitude=181'],
    ['a coordinate that is not a number', 'marine', 'latitude=here&longitude=151.27'],
  ])('400s on %s', async (_label, model, query) => {
    const res = await call(model, query);

    expect(res.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('400s on more points than the snap could ever probe', async () => {
    const many = Array.from({ length: 41 }, () => '-33.8').join(',');

    expect((await call('marine', `latitude=${many}&longitude=${many}`)).status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });
});
