/**
 * `BroadcastChannel` journal-change announcements (Decision 011): a second
 * same-origin tab hears a pending action start or clear and enters read-only
 * pending mode instead of offering another mutation. The server's own
 * `ACTION_IN_PROGRESS` stays authoritative whenever this coordination is
 * unavailable (an older browser, or the channel failing to construct).
 */

const CHANNEL_NAME = "ttr-action-journal";

export type JournalChannelMessage =
  | { readonly type: "pending"; readonly townId: string; readonly playerId: string }
  | { readonly type: "cleared"; readonly townId: string; readonly playerId: string };

export interface JournalChannel {
  readonly post: (message: JournalChannelMessage) => void;
  readonly subscribe: (
    listener: (message: JournalChannelMessage) => void,
  ) => () => void;
  readonly close: () => void;
}

/** `undefined` when `BroadcastChannel` is unavailable — callers fall back to server authority alone. */
export function openJournalChannel(): JournalChannel | undefined {
  if (typeof BroadcastChannel === "undefined") return undefined;

  const channel = new BroadcastChannel(CHANNEL_NAME);
  return {
    post: (message) => channel.postMessage(message),
    subscribe: (listener) => {
      const handler = (event: MessageEvent<JournalChannelMessage>) =>
        listener(event.data);
      channel.addEventListener("message", handler);
      return () => channel.removeEventListener("message", handler);
    },
    close: () => channel.close(),
  };
}
