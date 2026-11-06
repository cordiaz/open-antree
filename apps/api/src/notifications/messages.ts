// What customers receive. Free-text providers send `text`; WhatsApp Cloud API
// templates receive `params` as {{1}}, {{2}}, {{3}} (see README).

export type NotificationKind = 'near' | 'called';

export type MessageContext = {
  kind: NotificationKind;
  code: string;
  tenantName: string;
  customerName: string | null;
  // Tickets still ahead in the line ("near" only).
  ahead: number;
  // Counter the ticket was called to ("called" only).
  counterName: string | null;
};

export function renderMessage(c: MessageContext): {
  text: string;
  params: string[];
} {
  const hello = c.customerName ? `Halo ${c.customerName}, ` : 'Halo, ';
  if (c.kind === 'near') {
    const position =
      c.ahead === 0
        ? 'akan dipanggil berikutnya'
        : `tinggal ${c.ahead} nomor lagi sebelum dipanggil`;
    return {
      text: `${hello}nomor antrean ${c.code} di ${c.tenantName} ${position}. Mohon bersiap dan tetap berada di sekitar lokasi.`,
      params: [c.code, c.tenantName, String(c.ahead)],
    };
  }
  const counter = c.counterName ?? 'loket';
  return {
    text: `${hello}nomor antrean ${c.code} sekarang dipanggil. Silakan menuju ${counter} di ${c.tenantName}.`,
    params: [c.code, counter, c.tenantName],
  };
}
