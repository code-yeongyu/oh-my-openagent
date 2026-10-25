// Mechanically extracts every example phrase a review receipt quotes (backtick or double-quoted spans) into the consent
// corpus fixture (#10488 / #10498). Rows are only ever added: phrases already in the fixture are kept even when a later
// receipt no longer mentions them, so no change can pass by deleting a row. Sorted by code point, so every host writes
// the same file.
// Usage: bun packages/memory-core/scripts/extract-consent-corpus.ts <fixture.json> <receipt.md>...
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

type Row = { readonly phrase: string; readonly sources: readonly string[] };

const SPAN = /`([^`\n]{1,80})`|"([^"\n]{1,80})"/g;
const CODEY = /[\\/(){}[\]=|_*<>#$@^~;]|\.(?:ts|md|mjs|js|json)\b|^\s|\s$|\b(?:source|agent|user|true|false|VERDICT|bun|tsgo|git|README)\b|^[A-Za-z]*\d/;
const HANGUL = /[\u3131-\u318e\uac00-\ud7a3]/;
const ENGLISH_PHRASE = /^[A-Za-z][A-Za-z'\u2019 ,.!?-]{1,60}$/;

export function phrasesOf(markdown: string): string[] {
  const out: string[] = [];
  for (const m of markdown.matchAll(SPAN)) {
    const span = (m[1] ?? m[2] ?? "").trim().replace(/^…\s*/u, "").replace(/^"(.*)"$/u, "$1").trim();
    if (span.length === 0 || CODEY.test(span) || /^[a-z]+[A-Z]/.test(span)) continue;
    if (HANGUL.test(span) || (ENGLISH_PHRASE.test(span) && /[A-Za-z]{2}/.test(span))) out.push(span);
  }
  return out;
}

if (import.meta.main) {
  const [fixture, ...receipts] = process.argv.slice(2);
  if (!fixture || receipts.length === 0) { console.error("usage: extract-consent-corpus.ts <fixture.json> <receipt.md>..."); process.exit(2); }
  const rows = new Map<string, Set<string>>();
  if (existsSync(fixture)) for (const r of JSON.parse(readFileSync(fixture, "utf8")) as Row[]) rows.set(r.phrase, new Set(r.sources));
  for (const receipt of receipts) for (const p of phrasesOf(readFileSync(receipt, "utf8"))) (rows.get(p) ?? rows.set(p, new Set()).get(p))?.add(basename(receipt));
  const sorted = [...rows].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([phrase, s]) => ({ phrase, sources: [...s].sort() }));
  writeFileSync(fixture, `${JSON.stringify(sorted, null, 2)}\n`);
  console.log(`${sorted.length} rows`);
}
