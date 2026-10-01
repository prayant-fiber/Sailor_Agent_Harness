/** Timezone helpers for call windows (G4, L3). */

export function isValidTimeZone(tz: string | undefined): tz is string {
  if (!tz) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

export function localTime(tz: string | undefined, at = new Date()): string | undefined {
  if (!isValidTimeZone(tz)) return undefined;
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(at);
}

export function localHour(tz: string, at = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hour12: false }).format(at));
}

/** Common best-practice cold-call windows in the prospect's local time; also checks TCPA-style 8am–9pm bounds. */
export function callWindow(tz: string | undefined, at = new Date()): { label: string; okNow?: boolean } {
  if (!isValidTimeZone(tz)) return { label: "9–11am or 4–5pm prospect-local (timezone unknown)" };
  const h = localHour(tz, at);
  const okNow = h >= 8 && h < 21;
  return { label: `9–11am or 4–5pm ${tz} (now ${localTime(tz, at)})`, okNow };
}
