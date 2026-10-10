// Detector for the "stay on Bun 1.4.2" guard (senpi#3078, revisit-condition 3).
// Bun 1.4.2 carries CVE-2026-48618: its TLS hostname check accepts
// look-alike-dot hosts (U+3002, U+FF0E, U+FF61), fixed in 1.4.3. Staying on
// 1.4.2 is safe only while every shipped outbound TLS path derives its host
// from a URL parse: new URL() normalizes the look-alike dots, and APIs such
// as http2.connect(authority) parse their authority string the same way.
// This module reports raw TLS/HTTPS client usage; the reviewed allowlist in
// no-raw-tls-client.test.ts pins the exact call text and occurrence count.

export type AllowlistEntry = { file: string; call: string; count: number; reason: string }
export type ScanItem = { path: string; content: string }
export type ScanVerdict = { offenders: string[]; stale: string[] }
export type RawTlsHit = { line: number; id: string; text: string }

// The client surface of each module. Named imports outside these lists
// (createServer and friends) are inbound-only and stay unflagged.
const DANGEROUS_IMPORTS: Record<string, string[]> = {
  tls: ["connect", "TLSSocket"],
  https: ["request", "get", "Agent"],
  http2: ["connect"],
}

const CALL_PATTERNS: Array<[string, RegExp]> = [
  ["tls.connect(", /\btls\s*\.\s*connect\s*\(/g],
  ["https.request(", /\bhttps\s*\.\s*request\s*\(/g],
  ["https.get(", /\bhttps\s*\.\s*get\s*\(/g],
  ["http2.connect(", /\bhttp2\s*\.\s*connect\s*\(/g],
  ["Bun.connect(", /\bBun\s*\.\s*connect\s*\(/g],
  ["new https.Agent(", /\bnew\s+https\s*\.\s*Agent\s*\(/g],
  ["new tls.TLSSocket(", /\bnew\s+tls\s*\.\s*TLSSocket\s*\(/g],
  ["checkServerIdentity", /\bcheckServerIdentity\b/g],
]

// ES imports: group 1 catches "import type" (erased at compile time).
// Named imports only create bindings, whose call sites are flagged below;
// namespace and default imports grant the whole module and are flagged as
// module access. require()/import()/getBuiltinModule()/re-exports/template
// specifiers are module access too (review D1).
const IMPORT_STATEMENT = /\bimport\s+(type\s+)?([^;'"]*?)\s*from\s*["']((?:node:)?(?:tls|https|http2))["']/g
const REQUIRE_FORM = /\brequire\s*\(\s*["']((?:node:)?(?:tls|https|http2))["']\s*\)/g
const DYNAMIC_IMPORT_FORM = /\bimport\s*\(\s*["']((?:node:)?(?:tls|https|http2))["']\s*\)/g
const GET_BUILTIN_MODULE = /\bprocess\s*\.\s*getBuiltinModule\s*\(\s*["']((?:node:)?(?:tls|https|http2))["']\s*\)/g
const EXPORT_FROM = /\bexport\s+(type\s+)?([^;'"]*?)\s*from\s*["']((?:node:)?(?:tls|https|http2))["']/g
const TEMPLATE_MODULE_FORM = new RegExp("\\b(import|require)\\s*\\(\\s*`([^`]*)`\\s*\\)", "g")

type Segment = { text: string; verbatim: boolean }

// Split source into string literals (kept verbatim, comments dropped).
function segmentSource(text: string): Segment[] {
  const segments: Segment[] = []
  let plain = ""
  let literal = ""
  let quote: string | null = null
  let escaped = false
  let comment: "" | "/" | "*" = ""
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (comment) {
      const closes = (comment === "/" && ch === "\n") || (comment === "*" && ch === "*" && text[i + 1] === "/")
      if (closes) {
        if (comment === "*") i += 1
        comment = ""
        plain += " "
      }
      continue
    }
    if (quote) {
      literal += ch
      if (escaped) {
        escaped = false
      } else if (ch === "\\") {
        escaped = true
      } else if (ch === quote) {
        quote = null
        segments.push({ text: literal, verbatim: true })
        literal = ""
      }
      continue
    }
    if (ch === "/" && (text[i + 1] === "/" || text[i + 1] === "*")) {
      comment = text[i + 1] as "/" | "*"
      i += 1
      continue
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      if (plain) {
        segments.push({ text: plain, verbatim: false })
        plain = ""
      }
      quote = ch
      literal = ch
      continue
    }
    plain += ch
  }
  if (plain) segments.push({ text: plain, verbatim: false })
  if (literal) segments.push({ text: literal, verbatim: true })
  return segments
}

// Normalize a call for allowlist pinning: collapse whitespace and reformat
// spacing OUTSIDE string literals only, so string contents stay distinct
// (review D3) and reformatted calls still match their pinned text.
export function normalizeCallText(text: string): string {
  let out = ""
  for (const segment of segmentSource(text)) {
    if (segment.verbatim) {
      out += segment.text
      continue
    }
    out += segment.text
      .replace(/\s+/g, " ")
      .replace(/\(\s+/g, "(")
      .replace(/,\s+\)/g, ")")
      .replace(/\s+\)/g, ")")
  }
  return out.trim()
}

// String- and comment-aware balanced-paren scan with no length cap, so
// long calls and ")" inside string literals cannot truncate or mis-close
// the pinned text (review D3).
function findBalancedClose(content: string, openIndex: number): number {
  let depth = 0
  let quote: string | null = null
  let escaped = false
  let comment: "" | "/" | "*" = ""
  for (let i = openIndex; i < content.length; i += 1) {
    const ch = content[i]
    if (comment) {
      const closes = (comment === "/" && ch === "\n") || (comment === "*" && ch === "*" && content[i + 1] === "/")
      if (closes) {
        if (comment === "*") i += 1
        comment = ""
      }
      continue
    }
    if (quote) {
      if (escaped) {
        escaped = false
      } else if (ch === "\\") {
        escaped = true
      } else if (ch === quote) {
        quote = null
      }
      continue
    }
    if (ch === "/" && (content[i + 1] === "/" || content[i + 1] === "*")) {
      comment = content[i + 1] as "/" | "*"
      i += 1
      continue
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch
      continue
    }
    if (ch === "(") depth += 1
    else if (ch === ")" && --depth === 0) return i
  }
  return -1
}

function lineNumber(content: string, index: number): number {
  let line = 1
  for (let i = 0; i < index; i += 1) {
    if (content[i] === "\n") line += 1
  }
  return line
}

function escapeRegExp(text: string): string {
  return text.replace(new RegExp("[.*+?^${}()|[\\]\\\\]", "g"), "\\$&")
}

function moduleNameOf(specifier: string): string {
  return specifier.replace(/^node:/, "")
}

function namedSpecs(clause: string): Array<{ name: string; local: string }> {
  const braces = clause.match(/\{([^}]*)\}/)
  if (!braces) return []
  return braces[1]
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const pieces = part.split(/\s+as\s+/)
      return { name: pieces[0], local: pieces[1] ?? pieces[0] }
    })
}

function grantsWholeModule(clause: string): boolean {
  if (/\*\s*as\b/.test(clause)) return true
  const outside = clause.replace(/\{[^}]*\}/g, "").replace(/,/g, "").trim()
  return /[\w$]/.test(outside)
}

function templateModule(template: string): string | null {
  const staticText = template.replace(new RegExp("\\$\\{[^}]*\\}", "g"), "")
  const exact = staticText.match(/^\s*((?:node:)?(?:tls|https|http2))\s*$/)
  if (exact) return exact[1]
  if (/(?:node:)?(?:tls|https|http2)\b/.test(staticText)) return "unresolved"
  return null
}

function callTextFrom(content: string, match: RegExpMatchArray): string {
  const start = match.index ?? 0
  if (!match[0].endsWith("(")) return normalizeCallText(match[0])
  const close = findBalancedClose(content, start + match[0].length - 1)
  return close === -1
    ? normalizeCallText(content.slice(start))
    : normalizeCallText(content.slice(start, close + 1))
}

export function findRawTlsClients(content: string): RawTlsHit[] {
  const hits: RawTlsHit[] = []
  const seen = new Set<number>()
  const push = (index: number, id: string, text: string) => {
    if (seen.has(index)) return
    seen.add(index)
    hits.push({ line: lineNumber(content, index), id, text })
  }

  for (const [id, pattern] of CALL_PATTERNS) {
    for (const match of content.matchAll(pattern)) {
      push(match.index ?? 0, id, callTextFrom(content, match))
    }
  }

  // Named imports bind; their call sites are the flaggable act (the import
  // line itself is inert when the binding is unused) - review D2.
  const bindings: Array<{ local: string; specifier: string }> = []
  for (const match of content.matchAll(IMPORT_STATEMENT)) {
    if (match[1]) continue
    const clause = match[2] ?? ""
    const specifier = match[3] ?? ""
    if (grantsWholeModule(clause)) {
      push(match.index ?? 0, 'module access: import from "' + specifier + '"', normalizeCallText(match[0]))
    }
    for (const spec of namedSpecs(clause)) {
      if (DANGEROUS_IMPORTS[moduleNameOf(specifier)].includes(spec.name)) {
        bindings.push({ local: spec.local, specifier })
      }
    }
  }
  for (const binding of bindings) {
    const pattern = new RegExp("(?<![.\\w$])" + escapeRegExp(binding.local) + "\\s*\\(", "g")
    for (const match of content.matchAll(pattern)) {
      push(match.index ?? 0, 'binding call: ' + binding.local + ' (imported from "' + binding.specifier + '")', callTextFrom(content, match))
    }
  }

  const moduleForms: Array<[RegExp, string]> = [
    [REQUIRE_FORM, "require"],
    [DYNAMIC_IMPORT_FORM, "import"],
    [GET_BUILTIN_MODULE, "getBuiltinModule"],
  ]
  for (const [pattern, label] of moduleForms) {
    for (const match of content.matchAll(pattern)) {
      push(match.index ?? 0, label + '("' + match[1] + '")', normalizeCallText(match[0]))
    }
  }
  for (const match of content.matchAll(EXPORT_FROM)) {
    if (match[1]) continue
    const clause = match[2] ?? ""
    const specifier = match[3] ?? ""
    const grants =
      clause.includes("*") ||
      namedSpecs(clause).some((spec) => DANGEROUS_IMPORTS[moduleNameOf(specifier)].includes(spec.name))
    if (grants) {
      push(match.index ?? 0, 're-export from "' + specifier + '"', normalizeCallText(match[0]))
    }
  }
  for (const match of content.matchAll(TEMPLATE_MODULE_FORM)) {
    const module = templateModule(match[2] ?? "")
    if (module === null) continue
    const label = module === "unresolved" ? "tls/https/http2" : '"' + module + '"'
    push(match.index ?? 0, "template " + match[1] + " of " + label, normalizeCallText(match[0]))
  }

  return hits.sort((a, b) => a.line - b.line || a.id.localeCompare(b.id))
}
