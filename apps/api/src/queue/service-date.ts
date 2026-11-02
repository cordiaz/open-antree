// Calendar date (YYYY-MM-DD) in the tenant's timezone. Ticket numbering
// restarts on this date, so "today" must follow the tenant, not the server.
export function serviceDateFor(timezone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(now);
}

export function ticketCode(prefix: string, number: number): string {
  return `${prefix}${String(number).padStart(3, '0')}`;
}
