/**
 * Field normalizers for messy GTM data (edge cases E6–E10). Pure functions, no dependencies.
 */

const PERSONAL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "hotmail.com", "outlook.com", "live.com", "msn.com",
  "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "gmx.de", "web.de",
  "mail.com", "yandex.com", "yandex.ru", "zoho.com", "qq.com", "163.com", "126.com", "hey.com", "fastmail.com",
]);
const ROLE_LOCALS = new Set(["info", "sales", "support", "hello", "contact", "admin", "office", "team", "jobs", "careers", "hr", "billing", "noreply", "no-reply", "marketing", "press", "help"]);

export function normalizeDomain(input: string): string {
  if (!input) return "";
  let s = input.trim().toLowerCase();
  s = s.replace(/^mailto:/, "");
  if (s.includes("@") && !s.includes("/")) s = s.split("@").pop()!;
  s = s.replace(/^[a-z]+:\/\//, "").replace(/^www\d?\./, "");
  s = s.split(/[/?#:\s]/)[0];
  s = s.replace(/\.+$/, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s) ? s : "";
}

/** Returns canonical https://www.linkedin.com/in/<slug> (or /company/<slug>), or undefined if not a LinkedIn profile/company URL. */
export function normalizeLinkedinUrl(input: string): string | undefined {
  if (!input) return undefined;
  let s = input.trim();
  if (/^lnkd\.in\//i.test(s) || /\/\/lnkd\.in\//i.test(s)) return undefined; // shortener: cannot resolve offline
  if (!/linkedin\.com/i.test(s)) return undefined;
  s = s.replace(/^(https?:\/\/)?/i, "https://");
  let u: URL;
  try { u = new URL(s); } catch { return undefined; }
  const parts = u.pathname.split("/").filter(Boolean).map((p) => decodeURIComponent(p));
  const kind = parts[0]?.toLowerCase();
  if ((kind === "in" || kind === "pub") && parts[1]) return `https://www.linkedin.com/in/${parts[1].toLowerCase()}`;
  if ((kind === "company" || kind === "school" || kind === "showcase") && parts[1]) return `https://www.linkedin.com/${kind}/${parts[1].toLowerCase()}`;
  // Sales Navigator / Recruiter URLs carry opaque ids — keep them; Fiber accepts Sales Nav URNs.
  if (kind === "sales" || kind === "talent" || kind === "recruiter") return `https://www.linkedin.com${u.pathname.replace(/\/+$/, "")}`;
  return undefined;
}

export function linkedinSlug(input: string): string | undefined {
  const n = normalizeLinkedinUrl(input);
  const m = n?.match(/linkedin\.com\/(?:in|company|school|showcase)\/([^/?#]+)/);
  return m?.[1];
}

export function isSalesNavUrl(input: string): boolean {
  return /linkedin\.com\/(sales|talent|recruiter)\//i.test(input);
}

const EMAIL_RE = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Extract all emails from a messy cell ("Jane <jane@x.com>; mailto:j@y.io"). Lower-cased, de-duplicated. */
export function extractEmails(cell: string): string[] {
  if (!cell) return [];
  const found = cell.replace(/mailto:/gi, " ").match(EMAIL_RE) ?? [];
  return [...new Set(found.map((e) => e.toLowerCase().replace(/^[.'-]+|[.'-]+$/g, "")))];
}

export function normalizeEmail(cell: string): string | undefined {
  return extractEmails(cell)[0];
}

export function emailKind(email: string): "work" | "personal" | "role" {
  const [local, domain] = email.toLowerCase().split("@");
  if (ROLE_LOCALS.has(local)) return "role";
  if (PERSONAL_DOMAINS.has(domain)) return "personal";
  return "work";
}

export interface PhoneResult { e164?: string; raw: string; warning?: string }

const DEFAULT_CC: Record<string, string> = { US: "1", CA: "1", GB: "44", UK: "44", IN: "91", DE: "49", FR: "33", AU: "61", ES: "34", IT: "39", NL: "31", BR: "55", SG: "65", IE: "353" };

/** Best-effort E.164 normalization. Flags Excel scientific notation damage (E6). */
export function normalizePhone(cell: string, defaultRegion = "US"): PhoneResult {
  const raw = (cell ?? "").trim();
  if (!raw) return { raw };
  if (/^\d(\.\d+)?e\+?\d+$/i.test(raw)) return { raw, warning: "Phone looks like Excel scientific notation (digits lost). Re-export the source with the column as Text." };
  let s = raw.replace(/^tel:/i, "").replace(/(ext\.?|x|#)\s*\d+$/i, "").trim();
  const plus = s.startsWith("+") || s.startsWith("00");
  let digits = s.replace(/\D/g, "");
  if (s.startsWith("00")) digits = digits.slice(2);
  if (digits.length < 7 || digits.length > 15) return { raw, warning: "Not a plausible phone number length." };
  if (plus) return { raw, e164: `+${digits}` };
  const cc = DEFAULT_CC[defaultRegion.toUpperCase()] ?? "1";
  if (cc === "1" && digits.length === 11 && digits.startsWith("1")) return { raw, e164: `+${digits}` };
  if (cc === "1" && digits.length === 10) return { raw, e164: `+1${digits}` };
  if (digits.startsWith("0")) digits = digits.slice(1); // national trunk prefix
  return { raw, e164: `+${cc}${digits}`, warning: cc !== "1" ? `Assumed country code +${cc}` : undefined };
}

const PARTICLES = new Set(["van", "von", "der", "den", "de", "del", "della", "da", "di", "du", "la", "le", "bin", "al", "el", "y"]);
const HONORIFICS = /^(mr|mrs|ms|miss|dr|prof|sir|madam|mx)\.?\s+/i;
const SUFFIXES = /,?\s+(jr|sr|ii|iii|iv|phd|md|mba|cpa|esq)\.?$/i;

/** "SMITH, JOHN" → "John Smith"; keeps McDonald, O'Brien, van der Berg; leaves non-Latin scripts untouched (E9). */
export function normalizeName(cell: string): string {
  let s = (cell ?? "").replace(/\s+/g, " ").trim();
  if (!s) return s;
  s = s.replace(HONORIFICS, "").replace(SUFFIXES, "");
  const comma = s.match(/^([^,]+),\s*([^,]+)$/);
  if (comma) s = `${comma[2]} ${comma[1]}`;
  const isAllCaps = s === s.toUpperCase() && /[A-Z]/.test(s);
  const isAllLower = s === s.toLowerCase() && /[a-z]/.test(s);
  if (!isAllCaps && !isAllLower) return s; // mixed case is probably intentional
  return s.split(" ").map((w, i) => {
    const lw = w.toLowerCase();
    if (i > 0 && PARTICLES.has(lw)) return lw;
    return lw.replace(/(^|[-'’])(\p{L})/gu, (_m, sep, ch) => sep + ch.toUpperCase()).replace(/(^|[-'’])Mc(\p{L})/gu, (_m, sep, ch) => `${sep}Mc${ch.toUpperCase()}`);
  }).join(" ");
}

export function splitName(full: string): { first?: string; last?: string } {
  const parts = normalizeName(full).split(" ").filter(Boolean);
  if (parts.length === 0) return {};
  if (parts.length === 1) return { first: parts[0] };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

/** "John @ Acme", "John Smith - Acme Inc" → name + company hints. */
export function parseNameAtCompany(cell: string): { name?: string; company?: string } {
  const m = cell?.match(/^\s*(.+?)\s*(?:@| at | - | – | \| )\s*(.+?)\s*$/i);
  if (!m || m[1].includes("@")) return {};
  return { name: normalizeName(m[1]), company: m[2] };
}

export function normalizeCompanyName(cell: string): string {
  return (cell ?? "").replace(/\s+/g, " ").trim().replace(/[,.]?\s+(inc|llc|ltd|limited|gmbh|corp|corporation|co|plc|s\.?a\.?|b\.?v\.?|ag|pty)\.?$/i, "").trim();
}
