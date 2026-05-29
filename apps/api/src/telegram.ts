/**
 * Tiny Telegram Bot API client. We deliberately avoid pulling a heavyweight SDK
 * because we only need a single endpoint (`sendMessage`) and one or two diagnostics.
 *
 * Security:
 *   - Bot tokens NEVER leave the server. The web client only ever sees a 4-char suffix.
 *   - We use AbortSignal.timeout to bound network calls so a wedged Telegram doesn't
 *     pin a Fastify worker indefinitely.
 *   - parse_mode=HTML so user-provided text is escaped in the engine (see `escapeHtml`).
 */

const TELEGRAM_API = 'https://api.telegram.org';
const SEND_TIMEOUT_MS = 8_000;
// Photo uploads carry a ~60KB PNG, so give them more headroom than a text send.
const PHOTO_TIMEOUT_MS = 15_000;

export interface TelegramSendArgs {
  botToken: string;
  chatId: string;
  text: string;
  /** Default 'HTML'. Pass 'MarkdownV2' if the caller has escaped accordingly. */
  parseMode?: 'HTML' | 'MarkdownV2' | 'None';
}

export type TelegramSender = (args: TelegramSendArgs) => Promise<void>;

export const sendTelegramMessage: TelegramSender = async ({ botToken, chatId, text, parseMode = 'HTML' }) => {
  const url = `${TELEGRAM_API}/bot${botToken}/sendMessage`;
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  };
  if (parseMode !== 'None') body.parse_mode = parseMode;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`telegram_${res.status}: ${errBody.slice(0, 200)}`);
  }
  const parsed = (await res.json()) as { ok?: boolean; description?: string };
  if (!parsed.ok) {
    throw new Error(`telegram_error: ${parsed.description ?? 'unknown'}`);
  }
};

export interface TelegramPhotoArgs {
  botToken: string;
  chatId: string;
  /** PNG bytes. */
  photo: Uint8Array;
  /** Optional caption (max 1024 chars on Telegram's side). */
  caption?: string;
  parseMode?: 'HTML' | 'MarkdownV2' | 'None';
  filename?: string;
}

export type TelegramPhotoSender = (args: TelegramPhotoArgs) => Promise<void>;

/**
 * Send a photo via `sendPhoto` as multipart/form-data. We build the body with the
 * runtime's native FormData + Blob (Node 18+/26) so there's no multipart-encoding
 * dependency. Used by the alert engine to attach the crossover chart to each alert.
 */
export const sendTelegramPhoto: TelegramPhotoSender = async ({
  botToken,
  chatId,
  photo,
  caption,
  parseMode = 'HTML',
  filename = 'chart.png',
}) => {
  const url = `${TELEGRAM_API}/bot${botToken}/sendPhoto`;
  const form = new FormData();
  form.set('chat_id', chatId);
  if (caption) {
    // Telegram hard-caps captions at 1024 chars; trim defensively.
    form.set('caption', caption.slice(0, 1024));
    if (parseMode !== 'None') form.set('parse_mode', parseMode);
  }
  // Buffer/Uint8Array is a valid BlobPart.
  form.set('photo', new Blob([photo], { type: 'image/png' }), filename);
  const res = await fetch(url, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(PHOTO_TIMEOUT_MS),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`telegram_${res.status}: ${errBody.slice(0, 200)}`);
  }
  const parsed = (await res.json()) as { ok?: boolean; description?: string };
  if (!parsed.ok) {
    throw new Error(`telegram_error: ${parsed.description ?? 'unknown'}`);
  }
};

/**
 * Hit `getMe` to validate a bot token without sending a message. Used by the settings
 * UI's "Test bot token" button so the user finds typos before relying on the bot.
 */
export async function getTelegramBotInfo(botToken: string): Promise<{ username: string; firstName: string }> {
  const res = await fetch(`${TELEGRAM_API}/bot${botToken}/getMe`, {
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`telegram_${res.status}`);
  }
  const parsed = (await res.json()) as {
    ok?: boolean;
    description?: string;
    result?: { username?: string; first_name?: string };
  };
  if (!parsed.ok || !parsed.result) {
    throw new Error(`telegram_error: ${parsed.description ?? 'unknown'}`);
  }
  return {
    username: parsed.result.username ?? '',
    firstName: parsed.result.first_name ?? '',
  };
}

export interface DiscoveredChat {
  chatId: string;
  /** "private" | "group" | "supergroup" | "channel" — useful so the UI can warn when
   *  the bot landed in a group chat instead of a 1:1. */
  type: string;
  title?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
}

/**
 * Poll `getUpdates` and return every distinct chat the bot has seen a message from.
 *
 * Telegram retains pending updates for ~24h by default. The first call after the user
 * `/start`s the bot will return a single chat; if they `/start`ed multiple times or
 * the bot is in several chats, we return them all so the UI can let the user pick.
 *
 * Note: `getUpdates` and webhooks are mutually exclusive. If a webhook is set, Telegram
 * returns `Conflict` — the UI surfaces this so the user can delete the webhook.
 */
export async function discoverTelegramChats(botToken: string): Promise<DiscoveredChat[]> {
  const url = new URL(`${TELEGRAM_API}/bot${botToken}/getUpdates`);
  // `allowed_updates=["message"]` filters out edits/inline-query noise; `limit=100`
  // keeps the response bounded.
  url.searchParams.set('allowed_updates', JSON.stringify(['message']));
  url.searchParams.set('limit', '100');
  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`telegram_${res.status}: ${body.slice(0, 200)}`);
  }
  const parsed = (await res.json()) as {
    ok?: boolean;
    description?: string;
    result?: Array<{
      message?: {
        chat?: {
          id: number;
          type: string;
          title?: string;
          username?: string;
          first_name?: string;
          last_name?: string;
        };
      };
    }>;
  };
  if (!parsed.ok) {
    throw new Error(`telegram_error: ${parsed.description ?? 'unknown'}`);
  }
  const seen = new Map<string, DiscoveredChat>();
  for (const u of parsed.result ?? []) {
    const c = u.message?.chat;
    if (!c) continue;
    const id = String(c.id);
    if (seen.has(id)) continue;
    seen.set(id, {
      chatId: id,
      type: c.type,
      title: c.title,
      username: c.username,
      firstName: c.first_name,
      lastName: c.last_name,
    });
  }
  return [...seen.values()];
}
