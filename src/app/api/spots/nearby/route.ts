import { nearbySpots } from '../../../../lib/conditions';
import { errorResponse } from '../../../../lib/http';
import { getDb } from '../../../../lib/mongo';

export const runtime = 'nodejs';

/**
 * Saved spots near a point, nearest first.
 *
 * This sits beside `[id]` in the route tree and wins for `/api/spots/nearby`
 * because Next matches a static segment before a dynamic one. The only thing
 * that would break it is someone naming a spot id "nearby", which ObjectId
 * hex cannot be.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const query = new URL(request.url).searchParams;
    return Response.json(
      await nearbySpots(
        await getDb(),
        query.get('lat'),
        query.get('lon'),
        query.get('km') ?? undefined,
      ),
    );
  } catch (err) {
    return errorResponse(err);
  }
}
