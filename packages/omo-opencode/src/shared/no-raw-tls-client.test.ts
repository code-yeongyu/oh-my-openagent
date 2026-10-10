import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import path from "node:path"

// Guard for the "stay on Bun 1.4.2" decision (senpi#3078, revisit-condition 3).
//
// Bun 1.4.2 carries CVE-2026-48618: its TLS hostname check accepts
// look-alike-dot hosts (U+3002, U+FF0E, U+FF61), fixed in 1.4.3. Staying on
// 1.4.2 is safe only while every shipped outbound TLS path derives its host
// from a parsed URL: new URL() normalizes the look-alike dots, so the
// normalized name is rejected correctly on 1.4.2 as well. This test fails
// CI when shipped production source gains a direct low-level TLS/HTTPS
// client call that is not on the reviewed allowlist below, so the decision
// cannot silently go stale.

function repoRootFrom(start: string): string {
  let dir = start
  for (;;) {
    if (existsSync(path.join(dir, "bun.lock")) || existsSync(path.join(dir, ".git"))) {
      return dir
    }
    const parent = path.dirname(dir)
    if (parent === dir) {
      throw new Error("repo root sentinel not found")
    }
    dir = parent
  }
}

const WORKSPACE_ROOT = repoRootFrom(import.meta.dir)
const PACKAGES_DIR = path.join(WORKSPACE_ROOT, "packages")
// omo ships package src plus plugin/extension source; there is no root src/.
const SHIPPED_SOURCE_DIRS = ["src", "plugin"]
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"])
const EXCLUDED_SEGMENTS = new Set([
  "test",
  "tests",
  "__tests__",
  "fixtures",
  "__fixtures__",
  "test-support",
  "test-fixtures",
  "references",
  "docs",
])

type AllowlistEntry = {
  file: string
  call: string
  count: number
  reason: string
}

type ScanItem = {
  path: string
  content: string
}

type ScanVerdict = {
  offenders: string[]
  stale: string[]
}

// Reviewed allowlist. Each entry pins one exact call: the repo-relative
// file, the detected call's normalized text (whitespace collapsed, exactly
// as the failure message prints it), the expected occurrence count, and a
// one-line reason stating where the host comes from. A reason is only
// valid if the host is "new URL(...).hostname" or a literal. Adding or
// editing an entry is a reviewed act: name the host provenance and
// reference senpi#3078.
const ALLOWLIST: AllowlistEntry[] = [
  {
    file: "packages/omo-codex/plugin/scripts/auto-update-release-notes.mjs",
    call: 'import { get as httpsGet } from "node:https"',
    count: 1,
    reason: "httpsGet(url) at :109 receives the :107 template whose host is the fixed api.github.com prefix - repo and version interpolate into the path - and https.get parses the URL string before TLS (senpi#3078).",
  },
]

const OFFENDER_GUIDANCE = [
  "Shipped source must not gain raw TLS/HTTPS client calls.",
  "Bun 1.4.2 is pinned (senpi#3078) and carries CVE-2026-48618: its TLS hostname",
  "check accepts look-alike-dot hosts. We are safe only because every shipped",
  "outbound TLS path takes its host from a parsed URL - new URL() normalizes the",
  "dots. If this call site's host provably comes from new URL(...).hostname or a",
  "literal, add a reviewed entry to ALLOWLIST in",
  "packages/omo-opencode/src/shared/no-raw-tls-client.test.ts:",
  '    "packages/<pkg>/src/<file>.ts": "<one-line reason: where the host comes from>",',
  "Otherwise route the request through fetch(), which parses the URL.",
].join("\n")

// Direct client calls: the host argument bypasses URL parsing unless the
// allowlist proves otherwise. Bun.connect is flagged in every form because
// its tls: option path bypasses fetch's URL handling entirely.
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

// Import forms. The module specifier is anchored on both quotes, so
// "node:tlsx" or "./tls" never match. Group 1 catches "import type", which
// is erased at compile time and cannot reach the runtime.
const IMPORT_FROM =
  /import\s+(type\s+)?([^;'"]*?)\s*from\s*["']((?:node:)?(?:tls|https))["']/g
const REQUIRE_FORM = /\brequire\s*\(\s*["']((?:node:)?(?:tls|https))["']\s*\)/g
const DYNAMIC_IMPORT_FORM = /\bimport\s*\(\s*["']((?:node:)?(?:tls|https))["']\s*\)/g
const MODULE_FORMS: Array<[RegExp, string]> = [
  [REQUIRE_FORM, "require"],
  [DYNAMIC_IMPORT_FORM, "import"],
]

// A node:https import is flagged only when it grants request/get: namespace,
// default, require and dynamic forms grant the whole module; named imports
// are flagged only when request/get is among them, so
// "import { createServer } from 'node:https'" (inbound server) stays clean.
function httpsImportGrantsRequestGet(clause: string): boolean {
  if (/\*\s*as\b/.test(clause)) return true
  const named = clause.match(/\{([^}]*)\}/)
  if (!named) return /[\w$]/.test(clause)
  const outsideBraces = clause.replace(/\{[^}]*\}/g, "").replace(/,/g, "").trim()
  if (/[\w$]/.test(outsideBraces)) return true
  const names = named[1].split(",").map((part) => part.trim().split(/\s+as\s+/)[0].trim())
  return names.includes("request") || names.includes("get")
}

function normalizeCallText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/,\s*\)/g, ")")
    .replace(/\s+\)/g, ")")
}

// The matched call plus its balanced argument list, normalized, so a
// reformatted call still matches its pinned allowlist text.
function callText(content: string, match: RegExpMatchArray): string {
  const open = (match.index ?? 0) + match[0].length - 1
  let depth = 0
  let close = -1
  for (let i = open; i < content.length && i < open + 400; i += 1) {
    const character = content[i]
    if (character === "(") {
      depth += 1
    } else if (character === ")") {
      depth -= 1
      if (depth === 0) {
        close = i
        break
      }
    }
  }
  if (close === -1) close = Math.min(content.length, open + 400) - 1
  return normalizeCallText(content.slice(match.index ?? 0, close + 1))
}

function lineNumber(content: string, index: number): number {
  let line = 1
  for (let i = 0; i < index; i += 1) {
    if (content[i] === "\n") line += 1
  }
  return line
}

function findRawTlsClients(content: string): Array<{ line: number; id: string; text: string }> {
  const hits: Array<{ line: number; id: string }> = []
  for (const [id, pattern] of CALL_PATTERNS) {
    for (const match of content.matchAll(pattern)) {
      hits.push({ line: lineNumber(content, match.index ?? 0), id, text: callText(content, match) })
    }
  }
  for (const match of content.matchAll(IMPORT_FROM)) {
    const typeClause = match[1]
    const clause = match[2]
    const moduleName = match[3]
    if (typeClause) continue
    if (moduleName.endsWith("tls")) {
      hits.push({
        line: lineNumber(content, match.index ?? 0),
        id: 'import from "' + moduleName + '"',
        text: normalizeCallText(match[0]),
      })
    } else if (httpsImportGrantsRequestGet(clause)) {
      hits.push({
        line: lineNumber(content, match.index ?? 0),
        id: "import granting request/get from node:https",
        text: normalizeCallText(match[0]),
      })
    }
  }
  for (const [pattern, label] of MODULE_FORMS) {
    for (const match of content.matchAll(pattern)) {
      hits.push({
        line: lineNumber(content, match.index ?? 0),
        id: label + '("' + match[1] + '")',
        text: normalizeCallText(match[0]),
      })
    }
  }
  return hits.sort((a, b) => a.line - b.line || a.id.localeCompare(b.id))
}

function isScannedSourceFile(relativePath: string): boolean {
  const name = relativePath.slice(relativePath.lastIndexOf("/") + 1)
  if (/\.(test|spec)\.[a-z]+$/.test(name)) return false
  if (name.endsWith(".d.ts")) return false
  if (!SOURCE_EXTENSIONS.has(path.extname(name))) return false
  const segments = relativePath.split("/")
  if (segments.some((segment) => EXCLUDED_SEGMENTS.has(segment))) return false
  return true
}

function evaluateShippedSource(scan: ScanItem[], allowlist: AllowlistEntry[]): ScanVerdict {
  const offenders: string[] = []
  const stale: string[] = []
  for (const item of scan) {
    const hits = findRawTlsClients(item.content)
    if (hits.length === 0) continue
    if (allowlist.some((entry) => entry.file === item.path)) continue
    for (const hit of hits) {
      offenders.push(item.path + ":" + hit.line + "  " + hit.text)
    }
  }
  for (const entry of allowlist) {
    const item = scan.find((candidate) => candidate.path === entry.file)
    if (!item) {
      stale.push(entry.file + ": stale allowlist entry (no longer scanned)")
      continue
    }
    if (findRawTlsClients(item.content).length === 0) {
      stale.push(entry.file + ": stale allowlist entry (no raw TLS client calls left in file)")
    }
    if (!entry.reason || !entry.reason.trim()) {
      stale.push(entry.file + ": allowlist entry without a reason")
    }
  }
  return { offenders, stale }
}

function collectShippedSourceFiles(): string[] {
  const files: string[] = []
  const walk = (directory: string, relativeDirectory: string) => {
    let entries
    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const relativePath = relativeDirectory + "/" + entry.name
      if (entry.isDirectory()) {
        walk(path.join(directory, entry.name), relativePath)
        continue
      }
      if (isScannedSourceFile(relativePath)) files.push(relativePath)
    }
  }
  for (const pkg of readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
    if (!pkg.isDirectory()) continue
    for (const dirName of SHIPPED_SOURCE_DIRS) {
      walk(path.join(PACKAGES_DIR, pkg.name, dirName), "packages/" + pkg.name + "/" + dirName)
    }
  }
  return files.sort()
}

describe("no raw TLS client calls in shipped source (CVE-2026-48618, Bun 1.4.2)", () => {
  test("#given raw TLS client samples #when scanned #then every direct pattern and import form is caught with line numbers", () => {
    const samples: Array<[string, string]> = [
      ["tls.connect(", 'await tls.connect({ host: hostname, port: 443 });'],
      ["https.request(", "https.request(url, onResponse);"],
      ["https.get(", "https.get(url, onResponse);"],
      ["http2.connect(", 'http2.connect("https://example.com");'],
      ["Bun.connect(", 'Bun.connect({ hostname: host, port: 1 });'],
      ["new https.Agent(", "new https.Agent({ keepAlive: true });"],
      ["new tls.TLSSocket(", "new tls.TLSSocket(socket, options);"],
      ["checkServerIdentity", "const options = { checkServerIdentity: () => undefined };"],
      ['import from "node:tls"', 'import * as tls from "node:tls";'],
      ['import from "node:tls"', 'import { connect } from "node:tls";'],
      ['import from "tls"', 'import { connect as tlsConnect } from "tls";'],
      ['require("node:tls")', 'const tls = require("node:tls");'],
      ['import("node:tls")', 'const tls = await import("node:tls");'],
      ["import granting request/get from node:https", 'import { request } from "node:https";'],
      ["import granting request/get from node:https", 'import { get as httpsGet } from "node:https";'],
      ["import granting request/get from node:https", 'import * as https from "node:https";'],
      ["import granting request/get from node:https", 'import https from "node:https";'],
      ['require("node:https")', 'const https = require("node:https");'],
      ['import("node:https")', 'const https = await import("node:https");'],
    ]
    for (const [id, sample] of samples) {
      const hits = findRawTlsClients(sample)
      expect(hits.some((hit) => hit.id === id), "sample not caught as " + id + ": " + sample).toBe(true)
    }
    const positioned = findRawTlsClients('const a = 1;\n\nawait tls.connect({ host: "x", port: 1 });')
    expect(positioned).toEqual([{ line: 3, id: "tls.connect(", text: 'tls.connect({ host: "x", port: 1 })' }])
  })

  test("#given URL-parsed and inbound-server neighbors #when scanned #then nothing is flagged", () => {
    const samples = [
      'import { createServer } from "node:https";',
      'import type { Agent } from "node:https";',
      'import { connect } from "node:tlsx";',
      'import { connect } from "./tls";',
      "const response = await fetch(url);",
      "const { hostname } = new URL(url);",
      "tls.createServer(options, handler);",
      "https.createServer(options, handler);",
      "Bun.serve({ fetch: handler });",
      'const note = "prefer tls.connect over rolling your own";',
    ]
    for (const sample of samples) {
      expect(findRawTlsClients(sample), "unexpected hit: " + sample).toEqual([])
    }
  })

  test("#given candidate paths #when classified #then only shipped source files are scanned", () => {
    expect(isScannedSourceFile("packages/omo-opencode/src/shared/client.ts")).toBe(true)
    expect(isScannedSourceFile("packages/omo-codex/plugin/components/bootstrap/src/cli.ts")).toBe(true)
    expect(isScannedSourceFile("packages/omo-codex/plugin/scripts/tool.mjs")).toBe(true)
    expect(isScannedSourceFile("packages/memory-core/src/fs/client.test.ts")).toBe(false)
    expect(isScannedSourceFile("packages/memory-core/src/README.md")).toBe(false)
    expect(isScannedSourceFile("packages/omo-codex/plugin/components/bootstrap/test/download.test.ts")).toBe(false)
    expect(isScannedSourceFile("packages/memory-core/src/types.d.ts")).toBe(false)
  })

  test("#given shipped production source #when scanned #then no raw TLS client call exists outside the reviewed allowlist", () => {
    const files = collectShippedSourceFiles()
    expect(files.length).toBeGreaterThan(1000)
    const scan: ScanItem[] = files.map((relativePath) => ({
      path: relativePath,
      content: readFileSync(path.join(WORKSPACE_ROOT, relativePath), "utf8"),
    }))
    const verdict = evaluateShippedSource(scan, ALLOWLIST)
    expect(verdict.offenders, OFFENDER_GUIDANCE).toEqual([])
    expect(
      verdict.stale,
      "Every allowlist entry must match the shipped tree: file scanned, reason present.",
    ).toEqual([])
  })
  describe("allowlist pins exact call sites (in-memory)", () => {
    const pinnedCallEntry = (): AllowlistEntry => ({
      file: "pkg/a.ts",
      call: "http2.connect(baseUrl)",
      count: 2,
      reason: "host comes from new URL(...).hostname",
    })

    test("#given the exact allowlisted calls #when evaluated #then they pass with the exact counts", () => {
      const entries: AllowlistEntry[] = [
        pinnedCallEntry(),
        {
          file: "pkg/b.mjs",
          call: 'import { get as httpsGet } from "node:https"',
          count: 1,
          reason: "host is the api.example.com literal",
        },
      ]
      const scan: ScanItem[] = [
        { path: "pkg/a.ts", content: "one();\nhttp2.connect(baseUrl);\ntwo();\nhttp2.connect(baseUrl);\n" },
        { path: "pkg/b.mjs", content: 'import { get as httpsGet } from "node:https";\n' },
      ]
      expect(evaluateShippedSource(scan, entries)).toEqual({ offenders: [], stale: [] })
    })

    test("#given an allowlisted file with an extra different raw call #when evaluated #then it fails", () => {
      const scan: ScanItem[] = [
        {
          path: "pkg/a.ts",
          content: 'http2.connect(baseUrl);\nhttp2.connect(baseUrl);\ntls.connect({ host: "x", port: 1 });\n',
        },
      ]
      const verdict = evaluateShippedSource(scan, [pinnedCallEntry()])
      expect(
        verdict.offenders.some((line) => line.includes('tls.connect({ host: "x", port: 1 })')),
        "expected the new tls.connect to be flagged: " + JSON.stringify(verdict),
      ).toBe(true)
    })

    test("#given an extra occurrence of the allowlisted call #when evaluated #then the count mismatch fails", () => {
      const scan: ScanItem[] = [
        { path: "pkg/a.ts", content: "http2.connect(baseUrl);\nhttp2.connect(baseUrl);\nhttp2.connect(baseUrl);\n" },
      ]
      const verdict = evaluateShippedSource(scan, [pinnedCallEntry()])
      expect(
        verdict.stale.some((line) => line.includes("expected http2.connect(baseUrl) x2, found x3")),
        "expected a count mismatch: " + JSON.stringify(verdict),
      ).toBe(true)
    })

    test("#given a stale entry whose call is gone #when evaluated #then it fails", () => {
      const scan: ScanItem[] = [{ path: "pkg/a.ts", content: 'tls.connect({ host: "y", port: 2 });\n' }]
      const verdict = evaluateShippedSource(scan, [pinnedCallEntry()])
      expect(
        verdict.stale.some((line) => line.includes("expected http2.connect(baseUrl) x2, found x0")),
        "expected the stale entry to fail: " + JSON.stringify(verdict),
      ).toBe(true)
    })

    test("#given reformatted calls #when evaluated #then they still match the pinned text", () => {
      const scan: ScanItem[] = [
        { path: "pkg/a.ts", content: "http2.connect(\n  baseUrl,\n);\nhttp2.connect( baseUrl );\n" },
      ]
      expect(evaluateShippedSource(scan, [pinnedCallEntry()])).toEqual({ offenders: [], stale: [] })
    })
  })
})
