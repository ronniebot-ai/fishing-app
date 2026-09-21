import {
  anthropicFromEnv,
  CHAT_BODY_LIMIT,
  MODEL,
  streamAnswer,
} from '../../../lib/chat';
import { errorResponse, readJson } from '../../../lib/http';

// The Anthropic SDK needs Node, so this cannot run on the Edge runtime.
export const runtime = 'nodejs';

// An answer streams for as long as it streams; the platform default would cut
// a long one off mid-sentence.
export const maxDuration = 60;

/** What the renderer asks before deciding whether to show the panel at all. */
export async function GET(): Promise<Response> {
  const client = await anthropicFromEnv();
  return Response.json({ available: client !== null, model: client === null ? null : MODEL });
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readJson(request, CHAT_BODY_LIMIT);
    return await streamAnswer(await anthropicFromEnv(), body);
  } catch (err) {
    return errorResponse(err);
  }
}
