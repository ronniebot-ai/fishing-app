import { spotStats, STATS_DAYS } from '../../../../../lib/conditions';
import { errorResponse } from '../../../../../lib/http';
import { getDb } from '../../../../../lib/mongo';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

/** What this spot has looked like over the last `days` days. */
export async function GET(request: Request, { params }: Context): Promise<Response> {
  try {
    const { id } = await params;
    const days = new URL(request.url).searchParams.get('days');
    return Response.json(
      await spotStats(await getDb(), id, days === null ? STATS_DAYS : Number(days)),
    );
  } catch (err) {
    return errorResponse(err);
  }
}
