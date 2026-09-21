import { useChat } from '../hooks/useChat';
import { ChatPanel } from './ChatPanel';

interface SpotChatProps {
  /** The forecast the assistant answers from, built by `buildChatContext`. */
  context: string;
}

/**
 * The conversation, bound to a spot.
 *
 * This exists so that `ChatPanel` can stay a component that is handed a
 * transcript and knows nothing about where it came from — which is what makes
 * it worth a story and a test — while the conversation still resets when the
 * spot does. The caller mounts this under a key that is the coordinates, so
 * the reset is React's unmount rather than a rule written out by hand.
 */
export default function SpotChat({ context }: SpotChatProps) {
  const chat = useChat(context);

  return (
    <ChatPanel
      messages={chat.messages}
      pending={chat.pending}
      error={chat.error}
      atLimit={chat.atLimit}
      onSend={chat.send}
      onStop={chat.stop}
    />
  );
}
