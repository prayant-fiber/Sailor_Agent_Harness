/**
 * Secret redaction (edge case B2): keys must never reach the LLM context, Pi session JSONL, logs, or exports.
 */
const KEY_RE = /\bsk_(live|test|sandbox)_[A-Za-z0-9_-]{6,}/g;
const BEARER_RE = /(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi;
const GOOGLE_TOKEN_RE = /\bya29\.[A-Za-z0-9._-]{20,}/g;
const AWS_SIG_RE = /(X-Amz-Signature=)[0-9a-f]{16,}/gi;
const APIKEY_PARAM_RE = /([?&]apiKey=)[^&\s"']+/gi;

export function maskKey(key: string | undefined): string {
  if (!key) return "(none)";
  const m = key.match(/^(sk_[a-z]+_)(.*)$/);
  if (!m) return "****";
  return `${m[1]}****${m[2].slice(-4)}`;
}

export function redactText(text: string): string {
  return text
    .replace(KEY_RE, (k) => maskKey(k))
    .replace(BEARER_RE, "$1****")
    .replace(GOOGLE_TOKEN_RE, "ya29.****")
    .replace(AWS_SIG_RE, "$1****")
    .replace(APIKEY_PARAM_RE, "$1****");
}

export function containsSecret(text: string): boolean {
  KEY_RE.lastIndex = 0;
  return KEY_RE.test(text);
}

/** Deep-redacts strings inside any JSON-like value; also drops fields literally named apiKey. */
export function redactDeep<T>(value: T): T {
  if (typeof value === "string") return redactText(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/^(apiKey|api_key|x-api-key|authorization|refresh_token|access_token|client_secret)$/i.test(k)) {
        out[k] = "****";
      } else out[k] = redactDeep(v);
    }
    return out as T;
  }
  return value;
}
