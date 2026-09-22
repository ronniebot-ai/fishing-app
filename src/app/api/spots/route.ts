import { getDb } from '../../../lib/mongo';
import { errorResponse, readJson } from '../../../lib/http';
import { createSpot, listSpots } from '../../../lib/spots';

// The MongoDB driver opens a TCP socket, which the Edge runtime has no way
// to give it.
export const runtime = 'nodejs';

/** A spot is four small fields; anything larger is not one. */
const BODY_LIMIT = 8 * 1024;

export async function GET(): Promise<Response> {
  try {
    return Response.json(await listSpots(await getDb()));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readJson(request, BODY_LIMIT);
    return Response.json(await createSpot(await getDb(), body), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
