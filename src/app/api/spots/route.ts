import { getDb } from '../../../lib/db';
import { errorResponse, readJson } from '../../../lib/http';
import { createSpot, listSpots } from '../../../lib/spots';

// node:sqlite, and MongoDB after it, need the Node runtime rather than Edge.
export const runtime = 'nodejs';

/** A spot is four small fields; anything larger is not one. */
const BODY_LIMIT = 8 * 1024;

export async function GET(): Promise<Response> {
  try {
    return Response.json(listSpots(getDb()));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readJson(request, BODY_LIMIT);
    return Response.json(createSpot(getDb(), body), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
