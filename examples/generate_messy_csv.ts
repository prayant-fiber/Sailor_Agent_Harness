/**
 * Generates examples/messy_1k.csv — a deliberately broken CRM export that exercises every parser edge case
 * from docs/06_Edge_Cases_and_Gaps.md (E1–E10): Windows-1252 encoding, ';' delimiter, preamble rows before the
 * header, duplicate columns, mailto:/"Name <email>" cells, LinkedIn URL variants incl. Sales Navigator,
 * Excel-damaged phones, formula-injection cells, CJK names, "Last, First" names and blank rows.
 *   tsx examples/generate_messy_csv.ts [rows=1000]
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const rows = Number(process.argv[2] ?? 1000);
const first = ["Dana", "Raj", "Mei", "José", "Zoë", "Liam", "Aisha", "Kenji", "Olga", "Mateo", "Priya", "Noah"];
const last = ["Whitfield", "Menon", "Chen", "Peña", "Müller", "O'Brien", "van der Berg", "Tanaka", "Ivanova", "García", "Iyer", "McDonald"];
const companies = [["Loomly", "loomly.com"], ["Tidewave", "tidewave.io"], ["Parcelo", "parcelo.com"], ["Brightwave Inc.", "brightwave.ai"], ["Nordlicht GmbH", "nordlicht.de"]];
const titles = ["Head of RevOps", "VP Sales", "Director, Revenue Operations", "SDR Manager", "CRO", "Growth Lead"];

const lines: string[] = [
  "Exported from ACME CRM;;;;;;;",
  "Generated 2026-09-01 by j.doe;;;;;;;",
  "",
  "Contact;E-mail;Email;Company;Website;LinkedIn;Mobile;Title;Notes",
];
for (let i = 0; i < rows; i++) {
  const f = first[i % first.length], l = last[(i * 7) % last.length];
  const [co, dom] = companies[i % companies.length];
  const name = i % 9 === 0 ? `${l.toUpperCase()}, ${f.toUpperCase()}` : i % 23 === 0 ? `${f} @ ${co}` : i === 5 ? "李小龙" : `${f} ${l}`;
  const local = `${f}.${l}`.toLowerCase().replace(/[^a-z.]/g, "");
  const email = i % 5 === 0 ? `mailto:${local}@${dom}` : i % 7 === 0 ? `${f} <${local}@${dom}>` : i % 11 === 0 ? "" : `${local}@${dom}`;
  const li = i % 4 === 0 ? `https://www.linkedin.com/in/${local.replace(".", "-")}-${i}/?trk=abc`
    : i % 13 === 0 ? `https://www.linkedin.com/sales/lead/ACwAAA${i}XYZ,NAME_SEARCH,abc`
    : i % 6 === 0 ? `in.linkedin.com/in/${local.replace(".", "")}${i}` : "";
  const phone = i % 17 === 0 ? "1.21255501E+10" : i % 3 === 0 ? `(212) 555-${String(1000 + (i % 9000)).padStart(4, "0")}` : "";
  const notes = i % 97 === 0 ? '=HYPERLINK("http://evil.example","click")' : i % 31 === 0 ? '"met at SaaStr; wants demo\nfollow up Q4"' : "";
  const website = i % 2 ? `https://www.${dom}/` : dom;
  lines.push([name, email, i % 19 === 0 ? `${local}@gmail.com` : "", co, website, li, phone, titles[i % titles.length], notes].map((v) => (v.includes(";") && !v.startsWith('"') ? `"${v}"` : v)).join(";"));
  if (i % 250 === 249) lines.push(";;;;;;;;"); // blank separator rows
}
const text = lines.join("\r\n") + "\r\n";
// Encode as Windows-1252 (Excel default on Windows) — non-Latin-1 chars become '?', like a real Excel export.
const bytes = Uint8Array.from([...text].map((ch) => { const cp = ch.codePointAt(0)!; return cp < 256 ? cp : 63; }));
const out = join(import.meta.dirname ?? ".", "messy_1k.csv");
writeFileSync(out, bytes);
console.log(`wrote ${out} (${rows} rows, windows-1252, ';' delimited, header on line 4)`);
