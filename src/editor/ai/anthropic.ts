/**
 * Minimal Anthropic Messages API client.
 *
 * Browser-direct calls — the user's API key lives in local settings
 * and is sent on every request from the client. Documented as a
 * security tradeoff in PROJECT.md; users opt in by enabling AI
 * features and pasting their own key.
 */

/** Anthropic multipart content blocks (vision support). A text-only
 *  message can be a plain string; messages with images use the
 *  block-array form: `[{ type: 'text', text }, { type: 'image', ... }]`.
 *  Block ordering matters — Anthropic recommends placing images
 *  before the text instruction in multimodal prompts. */
export type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | {
      type: 'image';
      source: {
        type: 'base64';
        /** MIME type of the inlined bytes. Anthropic supports the common
         *  raster formats — `image/png`, `image/jpeg`, `image/gif`,
         *  `image/webp`. SVG / EMF / TIFF aren't supported by the
         *  vision API; callers should fall back gracefully. */
        media_type: string;
        /** Raw base64 (no `data:` prefix). */
        data: string;
      };
    };

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

export interface AnthropicRequest {
  apiKey: string;
  /** Default `claude-sonnet-4-6`; callers can override. */
  model?: string;
  /** Max tokens to generate. Defaults to a sane chat-reply size. */
  maxTokens?: number;
  /** System prompt. Falls back to the explainer-flavored default. */
  system?: string;
  messages: AnthropicMessage[];
}

export interface AnthropicReply {
  text: string;
}

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_TOKENS = 1024;
const ANTHROPIC_VERSION = '2023-06-01';

/** Custom error so callers can branch on AI-specific failures
 *  (missing key, auth error, rate limit, generic network) without
 *  parsing string messages. */
export class AnthropicError extends Error {
  constructor(
    message: string,
    /** HTTP status when the call reached the server, else `null`. */
    public readonly status: number | null,
    public readonly kind: 'no-key' | 'auth' | 'rate-limit' | 'server' | 'network' | 'parse',
  ) {
    super(message);
    this.name = 'AnthropicError';
  }
}

export async function callAnthropic(req: AnthropicRequest): Promise<AnthropicReply> {
  if (!req.apiKey || !req.apiKey.trim()) {
    throw new AnthropicError(
      'Anthropic API key is not set — open Settings to add one.',
      null,
      'no-key',
    );
  }

  const body = {
    model: req.model ?? DEFAULT_MODEL,
    max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
    ...(req.system ? { system: req.system } : {}),
    messages: req.messages,
  };

  let res: Response;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': req.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        // Required for direct-browser calls. Confirms the user opted
        // in to client-side API key exposure (we set it knowingly).
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new AnthropicError(
      `Network error contacting Anthropic: ${e instanceof Error ? e.message : String(e)}`,
      null,
      'network',
    );
  }

  if (!res.ok) {
    const kind: AnthropicError['kind'] =
      res.status === 401 ? 'auth' : res.status === 429 ? 'rate-limit' : 'server';
    let detail = '';
    try {
      const payload = await res.json() as { error?: { message?: string } };
      detail = payload?.error?.message ?? '';
    } catch {
      // Body wasn't JSON. Fall back to status text.
    }
    throw new AnthropicError(
      `Anthropic API returned ${res.status}${detail ? `: ${detail}` : ''}`,
      res.status,
      kind,
    );
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch (e) {
    throw new AnthropicError(
      `Failed to parse Anthropic response: ${e instanceof Error ? e.message : String(e)}`,
      res.status,
      'parse',
    );
  }

  // Response shape:
  //   { id, type: 'message', role: 'assistant',
  //     content: [{ type: 'text', text: '...' }, ...], ... }
  // We concatenate all text-typed content blocks; tool/structured
  // blocks (none expected for chat) are ignored.
  const content = (json as { content?: Array<{ type?: string; text?: string }> })?.content ?? [];
  const text = content
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('');
  if (!text) {
    throw new AnthropicError('Anthropic returned an empty response.', res.status, 'parse');
  }
  return { text };
}
