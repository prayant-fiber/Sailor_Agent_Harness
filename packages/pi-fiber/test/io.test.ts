import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeBuffer, detectHeaderRow, escapeFormula, parseCsv, readTable, readTableFromText, sniffDelimiter, toCsv } from "../src/core/io/csv";
import { emailKind, extractEmails, linkedinSlug, normalizeDomain, normalizeLinkedinUrl, normalizeName, normalizePhone, parseNameAtCompany } from "../src/core/io/normalize";
import { buildIdentity, detectColumns, isResolvable } from "../src/core/io/columns";

test("decodes UTF-8 BOM, UTF-16LE and Windows-1252 (E1)", () => {
  assert.equal(decodeBuffer(new Uint8Array([0xef, 0xbb, 0xbf, 0x61])).encoding, "utf-8-bom");
  const u16 = Buffer.from("﻿name,email\n", "utf16le");
  const d = decodeBuffer(u16);
  assert.equal(d.encoding, "utf-16le");
  assert.ok(d.text.startsWith("name"));
  const latin = Buffer.from([0x4a, 0x6f, 0x73, 0xe9]); // "José" in cp1252
  const l = decodeBuffer(latin);
  assert.equal(l.encoding, "windows-1252");
  assert.equal(l.text, "José");
});

test("sniffs ; , and tab delimiters (E2)", () => {
  assert.equal(sniffDelimiter("a;b;c\n1;2;3\n4;5;6"), ";");
  assert.equal(sniffDelimiter("a\tb\n1\t2"), "\t");
  assert.equal(sniffDelimiter('name,"notes; with semicolons"\nx,"y;z"'), ",");
});

test("parses quoted newlines, doubled quotes and unterminated quotes (E4)", () => {
  const { rows, issues } = parseCsv('a,b\n"line1\nline2","say ""hi"""\n');
  assert.deepEqual(rows[1], ["line1\nline2", 'say "hi"']);
  assert.equal(issues.length, 0);
  assert.equal(parseCsv('a,b\n"open,1').issues.length, 1);
});

test("finds header below a preamble and dedupes headers (E3)", () => {
  const text = "Exported from HubSpot\nGenerated 2026-09-01\nName,Email,Email,Company\nJane,j@x.com,j2@x.com,X\n\n";
  const rows = parseCsv(text).rows;
  assert.equal(detectHeaderRow(rows), 2);
  const t = readTableFromText(text);
  assert.deepEqual(t.headers, ["Name", "Email", "Email_2", "Company"]);
  assert.equal(t.records.length, 1);
  assert.equal(t.droppedBlankRows, 1);
});

test("escapes formula injection but keeps negative numbers (E5)", () => {
  assert.equal(escapeFormula('=HYPERLINK("http://evil","x")'), `'=HYPERLINK("http://evil","x")`);
  assert.equal(escapeFormula("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(escapeFormula("-5"), "-5");
  assert.equal(escapeFormula("+1 212 555 0100"), "'+1 212 555 0100");
  const csv = toCsv(["a"], [{ a: "=1+1" }]);
  assert.ok(csv.includes("'=1+1"));
});

test("normalizes LinkedIn URL variants (E7)", () => {
  assert.equal(normalizeLinkedinUrl("in.linkedin.com/in/Jane-Doe-123/?trk=x"), "https://www.linkedin.com/in/jane-doe-123");
  assert.equal(normalizeLinkedinUrl("https://www.linkedin.com/pub/jane-doe/1/2/3"), "https://www.linkedin.com/in/jane-doe");
  assert.equal(normalizeLinkedinUrl("linkedin.com/company/Stripe/about"), "https://www.linkedin.com/company/stripe");
  assert.match(normalizeLinkedinUrl("https://www.linkedin.com/sales/lead/ACwAAA123,NAME")!, /\/sales\/lead\//);
  assert.equal(normalizeLinkedinUrl("https://lnkd.in/abc"), undefined);
  assert.equal(linkedinSlug("https://linkedin.com/in/foo-bar/"), "foo-bar");
});

test("extracts and classifies emails (E8)", () => {
  assert.deepEqual(extractEmails("Jane <JANE@Acme.com>; mailto:j2@acme.com"), ["jane@acme.com", "j2@acme.com"]);
  assert.equal(emailKind("info@acme.com"), "role");
  assert.equal(emailKind("jane@gmail.com"), "personal");
  assert.equal(emailKind("jane@acme.com"), "work");
  assert.equal(normalizeDomain("https://www.Acme.com/about"), "acme.com");
  assert.equal(normalizeDomain("jane@acme.io"), "acme.io");
});

test("normalizes phones and flags Excel damage (E6)", () => {
  assert.equal(normalizePhone("(212) 555-0100").e164, "+12125550100");
  assert.equal(normalizePhone("+44 20 7946 0958").e164, "+442079460958");
  assert.match(normalizePhone("1.21255501E+10").warning!, /scientific/);
  assert.equal(normalizePhone("020 7946 0958", "GB").e164, "+442079460958");
});

test("normalizes names without breaking particles (E9)", () => {
  assert.equal(normalizeName("SMITH, JOHN"), "John Smith");
  assert.equal(normalizeName("ludwig van der berg"), "Ludwig van der Berg");
  assert.equal(normalizeName("MARY O'BRIEN-MCDONALD"), "Mary O'Brien-Mcdonald".replace("Mcdonald", "McDonald"));
  assert.equal(normalizeName("Dr. Jane Doe PhD"), "Jane Doe");
  assert.equal(normalizeName("李小龙"), "李小龙");
  assert.deepEqual(parseNameAtCompany("John @ Acme"), { name: "John", company: "Acme" });
});

test("detects columns from headers and values", () => {
  const t = readTable(Buffer.from("Contact,E-mail Address,Org,Profile,Mobile\nJane Doe,mailto:jane@acme.com,Acme Inc.,linkedin.com/in/jane-doe,(212) 555-0100\nBob,,Beta LLC,,\n"));
  const map = detectColumns(t.headers, t.records);
  assert.equal(map.roles.email, "E-mail Address");
  assert.equal(map.roles.linkedin, "Profile");
  assert.equal(map.roles.company, "Org");
  assert.equal(map.roles.fullName, "Contact");
  assert.equal(map.entityKind, "people");
  const id = buildIdentity(t.records[0], map);
  assert.equal(id.email, "jane@acme.com");
  assert.equal(id.company, "Acme");
  assert.equal(id.linkedinUrl, "https://www.linkedin.com/in/jane-doe");
  assert.equal(id.domain, "acme.com");
  assert.ok(isResolvable(id, "people"));
  assert.ok(isResolvable(buildIdentity(t.records[1], map), "people"));
});

test("detects a company-only list", () => {
  const t = readTableFromText("Company,Website\nStripe,https://stripe.com\nLoomly,loomly.com\n");
  const map = detectColumns(t.headers, t.records);
  assert.equal(map.entityKind, "companies");
  assert.equal(buildIdentity(t.records[0], map).domain, "stripe.com");
});
