import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../api/chat';
import { QUESTION_MAX } from '../hooks/useChat';

/**
 * Openers, for the moment the panel is empty and a blank field is the hardest
 * thing on the screen. They are the three questions the readings above cannot
 * answer on their own: whether to go now, when to go instead, and why the
 * number says what it says.
 */
const OPENERS = [
  'Is it worth going right now?',
  'When is the best window in the next two days?',
  'Why is the score what it is?',
] as const;

interface ChatPanelProps {
  messages: ChatMessage[];
  pending: boolean;
  error: Error | null;
  atLimit: boolean;
  onSend: (question: string) => void;
  onStop: () => void;
}

/**
 * Asking about the spot in words.
 *
 * Replies render as plain text, not markdown: the system prompt asks for
 * prose, and a renderer would be a dependency and a hole for anything the
 * model chose to emit. `white-space: pre-wrap` keeps the paragraphs the model
 * wrote without interpreting anything.
 */
export function ChatPanel({ messages, pending, error, atLimit, onSend, onStop }: ChatPanelProps) {
  const [question, setQuestion] = useState('');
  const foot = useRef<HTMLDivElement>(null);

  // Follow the answer as it is written, rather than making the reader chase
  // it. Optional-called because jsdom has no implementation of it.
  useEffect(() => {
    foot.current?.scrollIntoView?.({ block: 'nearest' });
  }, [messages]);

  const ask = (text: string) => {
    if (pending || atLimit) return;
    onSend(text);
    setQuestion('');
  };

  return (
    <section className="chat" aria-label="Ask about this spot">
      <div className="spine-head">
        <h2>Ask about this spot</h2>
        <span className="cursor-time">Claude reads the forecast above</span>
      </div>

      {messages.length > 0 && (
        <ol className="chat-log">
          {messages.map((message, i) => (
            <li
              // Turns are only ever appended, and the last one is rewritten in
              // place as it streams, so the position is a stable identity.
              key={i}
              className={`turn ${message.role}`}
            >
              <span className="who">{message.role === 'user' ? 'You' : 'Claude'}</span>
              <p className="said">
                {message.content || (pending ? 'Thinking…' : '')}
              </p>
            </li>
          ))}
        </ol>
      )}

      {messages.length === 0 && (
        <div className="chat-openers">
          {OPENERS.map((opener) => (
            <button key={opener} type="button" disabled={pending} onClick={() => ask(opener)}>
              {opener}
            </button>
          ))}
        </div>
      )}

      <form
        className="chat-ask"
        onSubmit={(event) => {
          event.preventDefault();
          ask(question);
        }}
      >
        <textarea
          value={question}
          rows={2}
          maxLength={QUESTION_MAX}
          disabled={atLimit}
          placeholder={atLimit ? 'Pick the spot again to start over' : 'Ask about the wind, the tide, the timing…'}
          aria-label="Ask a question about this spot"
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends, because a question is one line; a deliberate
            // Shift+Enter is the rare case that wants two.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              ask(question);
            }
          }}
        />
        {pending ? (
          <button type="button" onClick={onStop}>
            Stop
          </button>
        ) : (
          <button type="submit" disabled={atLimit || question.trim() === ''}>
            Ask
          </button>
        )}
        {error && (
          <span className="save-error" role="alert">
            {error.message}
          </span>
        )}
      </form>

      <div ref={foot} />

      <p className="chat-note">
        Answers are written by Claude from the forecast on this page, and it can
        still be wrong about what it reads. Nothing here knows your boat, your
        gear or the ground you are standing on. Check BOM before you go.
      </p>
    </section>
  );
}
