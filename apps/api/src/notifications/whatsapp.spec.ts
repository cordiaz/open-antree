import type { Mock } from 'vitest';
import { renderMessage } from './messages.js';
import {
  createSender,
  FonnteSender,
  MetaSender,
  SendError,
  type OutgoingMessage,
} from './whatsapp.js';

const message: OutgoingMessage = {
  to: '6281234567890',
  kind: 'called',
  text: 'Nomor A023 dipanggil',
  params: ['A023', 'Counter 01', 'Salon Mawar'],
};

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('WhatsApp senders', () => {
  let fetchMock: Mock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('Fonnte', () => {
    const sender = new FonnteSender('secret-token');

    it('posts the text with the token and returns the message id', async () => {
      fetchMock.mockResolvedValue(
        reply(200, { status: true, id: ['80367170'], process: 'pending' }),
      );
      await expect(sender.send(message)).resolves.toEqual({ id: '80367170' });

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.fonnte.com/send');
      expect(init.method).toBe('POST');
      expect(init.headers).toEqual({ Authorization: 'secret-token' });
      const body = init.body as URLSearchParams;
      expect(body.get('target')).toBe('6281234567890');
      expect(body.get('message')).toBe('Nomor A023 dipanggil');
      expect(body.get('countryCode')).toBe('0');
    });

    it('treats status: false as a permanent failure', async () => {
      fetchMock.mockResolvedValue(
        reply(200, { status: false, reason: 'target invalid' }),
      );
      const error = await sender.send(message).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(SendError);
      expect(error).toMatchObject({
        message: 'Fonnte: target invalid',
        retryable: false,
      });
    });

    it('retries server errors and network failures', async () => {
      fetchMock.mockResolvedValueOnce(reply(502, {}));
      await expect(sender.send(message)).rejects.toMatchObject({
        retryable: true,
      });
      fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
      await expect(sender.send(message)).rejects.toMatchObject({
        retryable: true,
      });
    });
  });

  describe('Meta Cloud API', () => {
    const sender = new MetaSender({
      token: 'meta-token',
      phoneNumberId: '106540352242922',
      templates: { near: 'antrean_dekat', called: 'antrean_dipanggil' },
      language: 'id',
      apiVersion: 'v23.0',
    });

    it('sends the template with params in order', async () => {
      fetchMock.mockResolvedValue(
        reply(200, {
          messages: [{ id: 'wamid.abc', message_status: 'accepted' }],
        }),
      );
      await expect(sender.send(message)).resolves.toEqual({ id: 'wamid.abc' });

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        'https://graph.facebook.com/v23.0/106540352242922/messages',
      );
      expect(init.headers).toMatchObject({
        Authorization: 'Bearer meta-token',
      });
      expect(JSON.parse(init.body as string)).toEqual({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: '6281234567890',
        type: 'template',
        template: {
          name: 'antrean_dipanggil',
          language: { code: 'id' },
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: 'A023' },
                { type: 'text', text: 'Counter 01' },
                { type: 'text', text: 'Salon Mawar' },
              ],
            },
          ],
        },
      });
    });

    it('retries rate limits but not rejected requests', async () => {
      fetchMock.mockResolvedValueOnce(
        reply(429, { error: { message: 'Too many messages' } }),
      );
      await expect(sender.send(message)).rejects.toMatchObject({
        message: 'Meta HTTP 429: Too many messages',
        retryable: true,
      });
      fetchMock.mockResolvedValueOnce(
        reply(400, { error: { message: 'Template name does not exist' } }),
      );
      await expect(sender.send(message)).rejects.toMatchObject({
        retryable: false,
      });
    });
  });

  describe('createSender', () => {
    const from = (env: Record<string, string>) => (key: string) => env[key];

    it('is off unless configured', () => {
      expect(createSender(from({}))).toBeNull();
      expect(createSender(from({ WHATSAPP_DRIVER: 'off' }))).toBeNull();
      expect(createSender(from({ WHATSAPP_DRIVER: 'log' }))?.name).toBe('log');
    });

    it('fails fast on missing settings or an unknown driver', () => {
      expect(() => createSender(from({ WHATSAPP_DRIVER: 'fonnte' }))).toThrow(
        'FONNTE_TOKEN is required for WHATSAPP_DRIVER=fonnte',
      );
      expect(() =>
        createSender(
          from({ WHATSAPP_DRIVER: 'meta', WHATSAPP_META_TOKEN: 'x' }),
        ),
      ).toThrow('WHATSAPP_META_PHONE_NUMBER_ID is required');
      expect(() => createSender(from({ WHATSAPP_DRIVER: 'sms' }))).toThrow(
        'Unknown WHATSAPP_DRIVER',
      );
    });
  });
});

describe('renderMessage', () => {
  const base = {
    code: 'A023',
    tenantName: 'Salon Mawar',
    customerName: null,
    ahead: 2,
    counterName: 'Counter 01',
  };

  it('writes the near message with the places left', () => {
    expect(renderMessage({ ...base, kind: 'near' })).toEqual({
      text: 'Halo, nomor antrean A023 di Salon Mawar tinggal 2 nomor lagi sebelum dipanggil. Mohon bersiap dan tetap berada di sekitar lokasi.',
      params: ['A023', 'Salon Mawar', '2'],
    });
    expect(
      renderMessage({ ...base, kind: 'near', ahead: 0, customerName: 'Budi' })
        .text,
    ).toBe(
      'Halo Budi, nomor antrean A023 di Salon Mawar akan dipanggil berikutnya. Mohon bersiap dan tetap berada di sekitar lokasi.',
    );
  });

  it('writes the called message with the counter', () => {
    expect(renderMessage({ ...base, kind: 'called' })).toEqual({
      text: 'Halo, nomor antrean A023 sekarang dipanggil. Silakan menuju Counter 01 di Salon Mawar.',
      params: ['A023', 'Counter 01', 'Salon Mawar'],
    });
  });
});
