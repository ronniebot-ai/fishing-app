import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { chatAvailable, streamChat, type ChatMessage } from '../api/chat';

/**
 * Matches MAX_TURNS on the server, counted in exchanges rather than messages
 * so the panel can say something honest before the server refuses.
 */
export const MAX_EXCHANGES = 10;

/** Matches MAX_MESSAGE_CHARS on the server, so the field stops where it does. */
export const QUESTION_MAX = 2000;

/**
 * Whether this build can answer questions at all.
 *
 * Separate from `useChat` because it is asked earlier and by someone else:
 * the app needs the answer to decide whether to load the panel's chunk, and
 * the panel is what holds a conversation.
 */
export function useChatAvailable(): boolean {
  const probe = useQuery({
    queryKey: ['chat', 'available'],
    queryFn: ({ signal }) => chatAvailable(signal),
    staleTime: Infinity, // A key does not appear while the app is running.
    gcTime: Infinity,
  });
  return probe.data === true;
}

export interface Chat {
  messages: ChatMessage[];
  /** True from the send until the last token, so the stop button has a job. */
  pending: boolean;
  error: Error | null;
  /** True once the transcript is as long as the server will accept. */
  atLimit: boolean;
  send: (question: string) => void;
  stop: () => void;
}

/**
 * The conversation about one spot.
 *
 * The transcript lives here rather than on the server: the API is stateless,
 * every request carries the whole thing, and there is nothing worth keeping
 * once the spot changes — the answers were reasoning about a forecast that is
 * no longer on screen. So there is no reset in here. The caller mounts this
 * under a key that is the spot, and React's own unmount is the reset.
 *
 * @param context what the assistant answers from; null until a forecast lands
 */
export function useChat(context: string | null): Chat {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  // An answer still being written when the panel goes belongs to a spot that
  // is no longer on screen, and nobody will read it.
  useEffect(() => () => abortRef.current?.abort(), []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPending(false);
  }, []);

  const send = useCallback(
    (question: string) => {
      const asked = question.trim();
      if (!asked || !context) return;

      const controller = new AbortController();
      abortRef.current = controller;
      setError(null);
      setPending(true);

      // Built from the rendered transcript, not from inside an updater: an
      // updater does not run where it is written — React defers it to the next
      // render — so reading the new history out of one sends the question with
      // an empty conversation behind it, and the server refuses a request the
      // user can see they made.
      const history: ChatMessage[] = [...messages, { role: 'user', content: asked }];

      // The empty assistant turn is what the tokens stream into, so the reply
      // appears word by word in the place it will finally occupy.
      setMessages([...history, { role: 'assistant', content: '' }]);

      const appendDelta = (delta: string) =>
        setMessages((current) => {
          const last = current[current.length - 1];
          if (!last || last.role !== 'assistant') return current;
          return [...current.slice(0, -1), { ...last, content: last.content + delta }];
        });

      streamChat(context, history, appendDelta, controller.signal)
        .catch((err: unknown) => {
          // Stopping is a decision, not a failure; the half-written answer stays.
          if (controller.signal.aborted) return;
          setError(err instanceof Error ? err : new Error('Could not reach Claude.'));
          // Drop the empty turn, so the transcript does not keep a blank reply
          // in the place the error is already being shown.
          setMessages((current) => {
            const last = current[current.length - 1];
            return last?.role === 'assistant' && last.content === ''
              ? current.slice(0, -1)
              : current;
          });
        })
        .finally(() => {
          if (abortRef.current === controller) abortRef.current = null;
          setPending(false);
        });
    },
    [context, messages],
  );

  return {
    messages,
    pending,
    error,
    atLimit: messages.filter((m) => m.role === 'user').length >= MAX_EXCHANGES,
    send,
    stop,
  };
}
