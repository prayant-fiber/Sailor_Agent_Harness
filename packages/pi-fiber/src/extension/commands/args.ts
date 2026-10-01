/** Tiny argv parser for slash commands: positional args, --flag, --key value, --key=value, quotes. */
export interface Parsed { _: string[]; flags: Record<string, string | boolean> }

export function tokenize(s: string): string[] {
  const out: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

export function parseArgs(s: string | undefined, booleanFlags: string[] = []): Parsed {
  const toks = tokenize(s ?? "");
  const res: Parsed = { _: [], flags: {} };
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.startsWith("--")) {
      const [k, v] = t.slice(2).split("=", 2);
      if (v !== undefined) res.flags[k] = v;
      else if (booleanFlags.includes(k) || i + 1 >= toks.length || toks[i + 1].startsWith("--")) res.flags[k] = true;
      else res.flags[k] = toks[++i];
    } else res._.push(t);
  }
  return res;
}

export const flagStr = (p: Parsed, k: string): string | undefined => (typeof p.flags[k] === "string" ? (p.flags[k] as string) : undefined);
export const flagNum = (p: Parsed, k: string): number | undefined => { const v = flagStr(p, k); return v !== undefined && Number.isFinite(Number(v)) ? Number(v) : undefined; };
export const flagBool = (p: Parsed, k: string): boolean => p.flags[k] === true || p.flags[k] === "true";
