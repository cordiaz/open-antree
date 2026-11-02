import { Logger } from '@nestjs/common';
import type { NotificationKind } from './messages.js';

export type OutgoingMessage = {
  // Digits with country code, e.g. 6281234567890.
  to: string;
  kind: NotificationKind;
  text: string;
  params: string[];
};

export interface WhatsAppSender {
  readonly name: string;
  // Resolves with the provider's message id, or throws a SendError.
  send(message: OutgoingMessage): Promise<{ id: string | null }>;
}

// `retryable` is false when trying again can't help (bad number, bad token,
// rejected template); those messages are marked failed straight away.
export class SendError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 10_000;

// Network errors, timeouts, rate limits and server errors are worth a retry.
async function post(url: string, init: RequestInit) {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      method: 'POST',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new SendError(
      `Request failed: ${error instanceof Error ? error.message : String(error)}`,
      true,
    );
  }
  const body = (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  return { response, body };
}

const retryableStatus = (status: number) => status === 429 || status >= 500;

// Development driver: writes messages to the log instead of sending them.
export class LogSender implements WhatsAppSender {
  readonly name = 'log';
  private readonly logger = new Logger('WhatsApp');

  send(message: OutgoingMessage) {
    this.logger.log(`to ${message.to} (${message.kind}): ${message.text}`);
    return Promise.resolve({ id: null });
  }
}

// Fonnte (https://fonnte.com), an Indonesian WhatsApp gateway that sends
// free text from a linked WhatsApp number.
export class FonnteSender implements WhatsAppSender {
  readonly name = 'fonnte';

  constructor(private readonly token: string) {}

  async send(message: OutgoingMessage) {
    const { response, body } = await post('https://api.fonnte.com/send', {
      headers: { Authorization: this.token },
      // Numbers are already international, so turn off the "0 -> 62" rewrite.
      body: new URLSearchParams({
        target: message.to,
        message: message.text,
        countryCode: '0',
      }),
    });
    if (!response.ok) {
      throw new SendError(
        `Fonnte HTTP ${response.status}`,
        retryableStatus(response.status),
      );
    }
    // Errors come back as 200 with status: false (sometimes "Status").
    if (body?.status !== true) {
      const reason =
        typeof body?.reason === 'string' ? body.reason : 'unknown error';
      throw new SendError(`Fonnte: ${reason}`, false);
    }
    const ids = body.id;
    return { id: Array.isArray(ids) && ids.length ? String(ids[0]) : null };
  }
}

export type MetaConfig = {
  token: string;
  phoneNumberId: string;
  templates: Record<NotificationKind, string>;
  language: string;
  apiVersion: string;
};

// WhatsApp Cloud API (Meta). Messages the business starts must use approved
// templates; `params` fill the template body in order.
export class MetaSender implements WhatsAppSender {
  readonly name = 'meta';

  constructor(private readonly config: MetaConfig) {}

  async send(message: OutgoingMessage) {
    const { token, phoneNumberId, templates, language, apiVersion } =
      this.config;
    const { response, body } = await post(
      `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: message.to,
          type: 'template',
          template: {
            name: templates[message.kind],
            language: { code: language },
            components: [
              {
                type: 'body',
                parameters: message.params.map((text) => ({
                  type: 'text',
                  text,
                })),
              },
            ],
          },
        }),
      },
    );
    if (!response.ok) {
      const error = body?.error as { message?: string } | undefined;
      throw new SendError(
        `Meta HTTP ${response.status}: ${error?.message ?? 'unknown error'}`,
        retryableStatus(response.status),
      );
    }
    const messages = body?.messages as { id?: string }[] | undefined;
    return { id: messages?.[0]?.id ?? null };
  }
}

// Builds the sender for WHATSAPP_DRIVER, or null when notifications are off.
// Missing settings fail at startup rather than on the first message.
export function createSender(
  get: (key: string) => string | undefined,
): WhatsAppSender | null {
  const required = (key: string) => {
    const value = get(key);
    if (!value) {
      throw new Error(`${key} is required for WHATSAPP_DRIVER=${driver}`);
    }
    return value;
  };
  const driver = get('WHATSAPP_DRIVER') ?? 'off';
  switch (driver) {
    case 'off':
      return null;
    case 'log':
      return new LogSender();
    case 'fonnte':
      return new FonnteSender(required('FONNTE_TOKEN'));
    case 'meta':
      return new MetaSender({
        token: required('WHATSAPP_META_TOKEN'),
        phoneNumberId: required('WHATSAPP_META_PHONE_NUMBER_ID'),
        templates: {
          near: required('WHATSAPP_META_TEMPLATE_NEAR'),
          called: required('WHATSAPP_META_TEMPLATE_CALLED'),
        },
        language: get('WHATSAPP_META_LANGUAGE') ?? 'id',
        apiVersion: get('WHATSAPP_META_API_VERSION') ?? 'v23.0',
      });
    default:
      throw new Error(
        `Unknown WHATSAPP_DRIVER "${driver}" (use off, log, fonnte or meta)`,
      );
  }
}
