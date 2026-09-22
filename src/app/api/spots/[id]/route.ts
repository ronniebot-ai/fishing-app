import { getDb } from '../../../../lib/mongo';
import { errorResponse, readJson } from '../../../../lib/http';
import { deleteSpot, renameSpot } from '../../../../lib/spots';

export const runtime = 'nodejs';

const BODY_LIMIT = 8 * 1024;

/** Next hands route params in as a promise, so every handler here awaits them. */
type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context): Promise<Response> {
  try {
    const { id } = await params;
    const body = await readJson(request, BODY_LIMIT);
    return Response.json(await renameSpot(await getDb(), id, body));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_request: Request, { params }: Context): Promise<Response> {
  try {
    const { id } = await params;
    await deleteSpot(await getDb(), id);
    return new Response(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
