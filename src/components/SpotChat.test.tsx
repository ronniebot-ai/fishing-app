/**
 * The conversation wired to the server.
 *
 * `ChatPanel.test.tsx` covers the panel given a transcript; this covers how
 * the transcript is built and what actually goes out on the wire — which is
 * where a question can be lost between the press and the request.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SpotChat from './SpotChat';

const CONTEXT = 'SPOT\nPosition: 33.8908°S 151.2743°E';

/** A streamed answer, the shape the server sends on success. */
function streaming(chunks: string[]) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
}

function setup(res: Response) {
  const fetchMock = vi.fn().mockResolvedValue(res);
  vi.stubGlobal('fetch', fetchMock);
  render(<SpotChat context={CONTEXT} />);
  return { fetchMock, user: userEvent.setup() };
}

const body = (fetchMock: ReturnType<typeof vi.fn>) =>
  JSON.parse(String(fetchMock.mock.calls[0][1].body));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SpotChat', () => {
  it('sends the question that was asked', async () => {
    // The transcript is built from state, and state does not update where it
    // is written — so the question can leave as an empty list and come back
    // a 400 that reads like the server's fault.
    const { fetchMock, user } = setup(streaming(['Yes.']));

    await user.type(screen.getByLabelText('Ask a question about this spot'), 'Worth going?{Enter}');

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(body(fetchMock)).toEqual({
      context: CONTEXT,
      messages: [{ role: 'user', content: 'Worth going?' }],
    });
  });

  it('shows the answer as it streams in', async () => {
    const { user } = setup(streaming(['Yes', ', about 3pm.']));

    await user.type(screen.getByLabelText('Ask a question about this spot'), 'Worth going?{Enter}');

    expect(await screen.findByText('Yes, about 3pm.')).toBeInTheDocument();
  });

  it('shows the reason when the server refuses, rather than nothing at all', async () => {
    const { user } = setup(
      Response.json({ error: 'The Claude key this build was given was refused.' }, { status: 502 }),
    );

    await user.type(screen.getByLabelText('Ask a question about this spot'), 'Worth going?{Enter}');

    expect(await screen.findByRole('alert')).toHaveTextContent(/key .* refused/);
    // The question stays; only the blank reply it was waiting on goes.
    expect(screen.getByText('Worth going?')).toBeInTheDocument();
    expect(screen.queryByText('Thinking…')).not.toBeInTheDocument();
  });

  it('carries the whole exchange into the next question', async () => {
    const { fetchMock, user } = setup(streaming(['Yes.']));
    const field = () => screen.getByLabelText('Ask a question about this spot');

    await user.type(field(), 'Worth going?{Enter}');
    await screen.findByText('Yes.');
    await user.type(field(), 'Why?{Enter}');

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(String(fetchMock.mock.calls[1][1].body)).messages).toEqual([
      { role: 'user', content: 'Worth going?' },
      { role: 'assistant', content: 'Yes.' },
      { role: 'user', content: 'Why?' },
    ]);
  });
});
