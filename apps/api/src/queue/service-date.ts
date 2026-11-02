// Calendar date (YYYY-MM-DD) in the tenant's timezone. Ticket numbering
// restarts on this date, so "today" must follow the tenant, not the server.
export function serviceDateFor(timezone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(now);
}

export function ticketCode(prefix: string, number: number): string {
  return `${prefix}${String(number).padStart(3, '0')}`;
}

// Calendar arithmetic on YYYY-MM-DD strings (no timezone involved).
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000,
  );
}

// True for a real calendar date, e.g. rejects 2026-02-30.
export function isCalendarDate(date: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) &&
    addDays(date, 0) === date
  );
}
