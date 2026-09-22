import { recordSnapshots } from '../../../../../lib/conditions';
import { errorResponse, readJson } from '../../../../../lib/http';
import { getDb } from '../../../../../lib/mongo';

export const runtime = 'nodejs';

/** 48 hours of readings, with room to spare. A spot's own body limit is 8 kb. */
const BODY_LIMIT = 64 * 1024;

type Context = { params: Promise<{ id: string }> };

/**
 * Record what the app is showing for this spot.
 *
 * Called by the page once a forecast has landed, and deliberately not awaited
 * by it: this is the statistics side of the app, and nothing on screen should
 * wait for it or break when it fails.
 */
export async function POST(request: Request, { params }: Context): Promise<Response> {
  try {
    const { id } = await params;
    const body = await readJson(request, BODY_LIMIT);
    return Response.json(await recordSnapshots(await getDb(), id, body), { status: 202 });
  } catch (err) {
    return errorResponse(err);
  }
}
