/**
 * Open-Meteo, behind the edge cache.
 *
 * The page used to call Open-Meteo directly from the browser, which meant
 * every visitor looking at the same stretch of coast paid for the same
 * request. Open-Meteo's free tier is non-commercial and roughly 10,000
 * requests a day, and a single spot costs two or three of them, so that
 * ceiling was the nearest real limit this app had.
 *
 * Going through here instead gives one shared cache for everybody. The ocean
 * snap in particular benefits more than it looks: it probes 25 candidates in
 * one batched request whose coordinates are generated from a fixed grid step,
 * so two people who tap anywhere near each other produce byte-identical URLs
 * and the second one is served from the edge.
 *
 * Edge rather than Node because there is nothing to do here but rewrite a URL
 * and pass a response along — no database, no SDK, nothing that needs a socket.
 */

export const runtime = 'edge';

const UPSTREAM = {
  forecast: 'https://api.open-meteo.com/v1/forecast',
  marine: 'https://marine-api.open-meteo.com/v1/marine',
} as const;

type Model = keyof typeof UPSTREAM;

/**
 * Only these are forwarded. An open proxy would let anyone put anything in
 * front of our cache key, and Open-Meteo would happily answer requests this
 * app has no use for.
 */
const ALLOWED = [
  'latitude',
  'longitude',
  'hourly',
  'current',
  'timezone',
  'forecast_days',
  'past_days',
  'wind_speed_unit',
] as const;

/** The snap probes 25 candidates at once. Nothing legitimate asks for more. */
const MAX_POINTS = 40;

/**
 * The model updates hourly, so a quarter of an hour is fresh by any measure a
 * fishing forecast cares about. `stale-while-revalidate` means the moment it
 * expires still costs nobody a round trip to Open-Meteo.
 */
const CACHE = 'public, s-maxage=900, stale-while-revalidate=3600';

function bad(reason: string): Response {
  return Response.json({ error: true, reason }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
}

/** A comma-separated list of coordinates, as Open-Meteo's batch form takes. */
function readPoints(value: string | null, limit: number): number[] | null {
  if (value === null) return null;
  const parts = value.split(',');
  if (parts.length === 0 || parts.length > MAX_POINTS) return null;

  const points = parts.map(Number);
  if (points.some((n) => !Number.isFinite(n) || Math.abs(n) > limit)) return null;
  return points;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ model: string }> },
): Promise<Response> {
  const { model } = await params;
  const upstream = UPSTREAM[model as Model];
  if (upstream === undefined) return bad('Unknown model.');

  const query = new URL(request.url).searchParams;

  const lat = readPoints(query.get('latitude'), 90);
  const lon = readPoints(query.get('longitude'), 180);
  if (lat === null || lon === null) return bad('latitude and longitude are required.');
  if (lat.length !== lon.length) return bad('latitude and longitude must pair up.');

  // Rebuilt in a fixed order rather than passed through, so the URL this
  // sends upstream does not depend on the order the caller happened to use.
  const forward = new URLSearchParams();
  for (const key of ALLOWED) {
    const value = query.get(key);
    if (value !== null) forward.set(key, value);
  }

  let answer: Response;
  try {
    answer = await fetch(`${upstream}?${forward}`, {
      headers: { accept: 'application/json' },
      // Vercel caches on the response headers below; this is the runtime's own
      // fetch cache, which would otherwise hold a second copy to no purpose.
      cache: 'no-store',
    });
  } catch {
    return Response.json(
      { error: true, reason: 'Could not reach Open-Meteo.' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // Open-Meteo reports its own failures as {error: true, reason} with a 4xx,
  // which the client already knows how to read. Pass it through rather than
  // rewriting it — but never cache it.
  return new Response(answer.body, {
    status: answer.status,
    headers: {
      'Content-Type': answer.headers.get('content-type') ?? 'application/json',
      'Cache-Control': answer.ok ? CACHE : 'no-store',
    },
  });
}
