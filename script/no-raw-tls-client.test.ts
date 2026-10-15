import { describe, expect, test } from "bun:test"
import path from "node:path"
import {
  type AllowlistEntry,
  type ScanItem,
  collectShippedSourceFiles,
  evaluateShippedSource,
  findRawTlsClients,
  isKnownBuiltRuntime,
  isScannedSourceFile,
  listTrackedFiles,
  readSourceFile,
  WORKSPACE_ROOT,
} from "./no-raw-tls-client-scan"

// Reviewed allowlist. Each entry pins one exact call: the repo-relative
// file, the detected call's normalized text (whitespace collapsed outside
// string literals, exactly as the failure message prints it), the expected
// occurrence count, and a one-line reason stating where the host comes
// from. A reason is valid only if the host reaches TLS through a URL parse
// - new URL(...).hostname, or an API such as https.get(urlString) /
// http2.connect(authority) that parses its argument - or is a literal.
// Adding or editing an entry is a reviewed act: name the host provenance
// and reference senpi#3078.
// Known limits: createRequire through namespace/default module imports or
// require("node:module") chains; require.apply, require aliases/sequence calls;
// detached getBuiltinModule aliases/.call; variable Bun keys; globalThis Bun
// destructuring; variable/const-folded module specifiers; Reflect.get(Bun, "connect").
// This is a regression guard, not a complete data-flow or evasion detector.
const ALLOWLIST: AllowlistEntry[] = [
  ...["omo-codex", "omo-senpi"].flatMap((edition) => ["https", "tls"].map((module) => ({
    file: `packages/${edition}/plugin/skills/browser/runtime/omowright/index.js`,
    call: `__require("${module}")`,
    count: 1,
    reason: "bundled ws@8.21.3 acquisition: request options and tls.connect(options) derive host/servername from new URL(address).hostname; the connector call remains independently pinned (omowright#40, senpi#3078).",
  }))),
  {
    file: "packages/omo-codex/plugin/scripts/auto-update-release-notes.mjs",
    call: 'import { get as httpsGet } from "node:https"',
    count: 1,
    reason: "this acquisition supplies the single pinned httpsGet(url, ...) call below; https.get parses the literal api.github.com authority before TLS (senpi#3078).",
  },
  {
    file: "packages/omo-codex/plugin/scripts/auto-update-release-notes.mjs",
    call: "httpsGet(url, { headers: { Accept: \"application/vnd.github+json\", \"User-Agent\": \"lazycodex-auto-update\", }, }, (response) => { if (response.statusCode !== 200) { response.resume(); resolve(undefined); return; } let body = \"\"; response.setEncoding(\"utf8\"); response.on(\"data\", (chunk) => { body += chunk; if (body.length > 128_000) request.destroy(); }); response.on(\"end\", () => { try { const parsed = JSON.parse(body); resolve(typeof parsed.body === \"string\" && parsed.body.trim() ? truncateReleaseNotes(parsed.body) : undefined); } catch (error) { if (error instanceof Error) { resolve(undefined); return; } throw error; } }); })",
    count: 1,
    reason: "the only outbound call; the url argument is the api.github.com template prefix built in fetchGithubReleaseNotes (repo and version interpolate into the path, not the host) and https.get URL-parses it before TLS (senpi#3078).",
  },
  {
    file: "packages/omo-codex/plugin/skills/browser/runtime/omowright/index.js",
    call: "tls.connect(options)",
    count: 1,
    reason: "bundled ws@8.21.3 WebSocket client: host and servername come from new URL(address).hostname (ws/lib/websocket.js:703-758,1083-1090); verified on Bun 1.4.2 in omowright#40",
  },
  {
    file: "packages/omo-senpi/plugin/skills/browser/runtime/omowright/index.js",
    call: "tls.connect(options)",
    count: 1,
    reason: "bundled ws@8.21.3 WebSocket client: host and servername come from new URL(address).hostname (ws/lib/websocket.js:703-758,1083-1090); verified on Bun 1.4.2 in omowright#40",
  },
]

const OFFENDER_GUIDANCE = [
  "Shipped source must not gain raw TLS/HTTPS client calls.",
  "Bun 1.4.2 is pinned (senpi#3078) and carries CVE-2026-48618: its TLS hostname",
  "check accepts look-alike-dot hosts. We are safe only because every shipped",
  "outbound TLS path reaches its host through a URL parse - new URL() normalizes",
  "the dots, and APIs like https.get(urlString)/http2.connect(authority) parse",
  "their argument. If this call's host provably does the same, or is a literal,",
  "add a reviewed entry to ALLOWLIST in",
  "script/no-raw-tls-client.test.ts:",
  '    { file: "<path>", call: "<exact normalized call text>", count: <n>, reason: "<host provenance>" },',
  "Otherwise route the request through fetch(), which parses the URL.",
].join("\n")

const STALE_GUIDANCE = "Every allowlist entry must match the shipped tree: file scanned, normalized call text found, occurrence count exact, reason present."

describe("no raw TLS client calls in shipped source (CVE-2026-48618, Bun 1.4.2)", () => {
  test("#given raw client samples #when scanned #then sampled client patterns, module forms and bindings are caught with line numbers", () => {
    const samples: Array<[string, string]> = [
      ['module access: import from "node:tls"', 'import { connect } from "node:tls";'],
      ['module access: import from "node:https"', 'import { createServer } from "node:https";'],
      ['module access: import from "node:http2"', 'import { createServer } from "node:http2"; createServer(h);'],
      ["tls.connect(", 'await tls.connect({ host: hostname, port: 443 });'],
      ["https.request(", "https.request(url, onResponse);"],
      ["https.get(", "https.get(url, onResponse);"],
      ["http2.connect(", 'http2.connect("https://example.com");'],
      ["Bun.connect(", 'Bun.connect({ hostname: host, port: 1 });'],
      ["new https.Agent(", "new https.Agent({ keepAlive: true });"],
      ["new tls.TLSSocket(", "new tls.TLSSocket(socket, options);"],
      ["checkServerIdentity", "const options = { checkServerIdentity: () => undefined };"],
      ['require("node:tls")', 'const tls = require("node:tls");'],
      ['require("https")', "const https = require('https');"],
      ['import("node:tls")', 'const tls = await import("node:tls");'],
      ['getBuiltinModule("node:tls")', 'const tls = process.getBuiltinModule("node:tls");'],
      ['getBuiltinModule("node:http2")', 'const h2 = process.getBuiltinModule("node:http2");'],
      ['re-export from "node:tls"', 'export { connect } from "node:tls";'],
      ['re-export from "node:https"', 'export * from "node:https";'],
      ['module access: import from "node:http2"', 'import * as http2 from "node:http2";'],
      ['module access: import from "node:https"', 'import https from "node:https";'],
      ['binding call: httpsGet (imported from "node:https")', 'import { get as httpsGet } from "node:https";\nhttpsGet(url);'],
      ['binding call: connect (imported from "node:http2")', 'import { connect } from "node:http2";\nconnect(host);'],
      ['binding call: h2c (imported from "node:http2")', 'import { connect as h2c } from "node:http2";\nh2c(host);'],
      ['binding call: TLSSocket (imported from "node:tls")', 'import { TLSSocket } from "node:tls";\nnew TLSSocket(sock);'],
      ['template import of "node:tls"', "const tls = await import(`node:tls`);"],
      ['template require of "node:https"', "const m = require(`node:https`);"],
    ]
    for (const [id, sample] of samples) {
      const hits = findRawTlsClients(sample)
      expect(hits.some((hit) => hit.id === id), "sample not caught as " + id + ": " + sample).toBe(true)
    }
    const positioned = findRawTlsClients('const a = 1;\n\nawait tls.connect({ host: "x", port: 1 });')
    expect(positioned).toEqual([{ line: 3, id: "tls.connect(", text: 'tls.connect({ host: "x", port: 1})' }])
  })

  test("#given inert neighbors #when scanned #then nothing is flagged", () => {
    const samples = [
      'import { connect } from "node:tlsx"; connect(h);',
      'import type { Agent } from "node:https";',
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
    expect(isScannedSourceFile("bin/platform.js")).toBe(true)
    expect(isScannedSourceFile("packages/memory-core/src/fs/client.test.ts")).toBe(false)
    expect(isScannedSourceFile("packages/memory-core/src/README.md")).toBe(false)
    expect(isScannedSourceFile("packages/omo-codex/plugin/components/bootstrap/test/download.test.ts")).toBe(false)
    expect(isScannedSourceFile("packages/memory-core/src/types.d.ts")).toBe(false)
  })

  test("#given the scan #when collected #then only tracked files under shipped roots are scanned", () => {
    const tracked = new Set(listTrackedFiles())
    const files = collectShippedSourceFiles()
    for (const file of files) {
      expect(tracked.has(file) || isKnownBuiltRuntime(file), "untracked file scanned: " + file).toBe(true)
    }
    const collected = new Set(files)
    for (const shipped of [
      "bin/platform.js",
      "postinstall.mjs",
      "packages/shared-skills/index.mjs",
      "packages/omo-native/compile-entry.ts",
      "packages/omo-codex/scripts/check-model-catalog-parity.mjs",
    ]) {
      expect(collected.has(shipped), "shipped file not scanned: " + shipped).toBe(true)
    }
  })

  test("#given source reads #when a file is missing or a path is a directory #then only ENOENT is tolerated", () => {
    expect(readSourceFile(path.join(WORKSPACE_ROOT, "definitely-missing-file.ts"))).toBe(null)
    expect(() => readSourceFile(path.join(WORKSPACE_ROOT, "bin"))).toThrow()
  })

  test("#given calls with tricky strings #when normalized #then string contents stay distinct", () => {
    const paren = findRawTlsClients('tls.connect({ host: ")" + h });')
    expect(paren[0]?.text).toBe('tls.connect({ host: ")" + h})')
    const withSpaces = findRawTlsClients('tls.connect({ host: "a  b" });')
    const single = findRawTlsClients('tls.connect({ host: "a b" });')
    expect(withSpaces[0]?.text).not.toBe(single[0]?.text)
    const long1 = 'tls.connect({ pad: "' + "x".repeat(500) + '" });'
    const long2 = 'tls.connect({ pad: "' + "x".repeat(499) + 'y" });'
    const t1 = findRawTlsClients(long1)[0]?.text
    const t2 = findRawTlsClients(long2)[0]?.text
    expect(t1 !== undefined && t2 !== undefined && t1 !== t2, ">400-char calls must not collide").toBe(true)
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
        { file: "pkg/b.mjs", call: 'require("node:https")', count: 1, reason: "host is a literal" },
        { file: "pkg/b.mjs", call: "https.get(url)", count: 1, reason: "host is a literal" },
      ]
      const scan: ScanItem[] = [
        { path: "pkg/a.ts", content: "one();\nhttp2.connect(baseUrl);\ntwo();\nhttp2.connect(baseUrl);\n" },
        { path: "pkg/b.mjs", content: 'const https = require("node:https");\nhttps.get(url);\n' },
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
        verdict.offenders.some((line) => line.includes('tls.connect({ host: "x", port: 1})')),
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

    test("#given a named import and call pinned separately #when evaluated #then new calls still fail", () => {
      const entries: AllowlistEntry[] = [
        { file: "pkg/b.mjs", call: 'import { get as httpsGet } from "node:https"', count: 1, reason: "supplies the pinned URL client" },
        { file: "pkg/b.mjs", call: 'httpsGet(url, { redaction: "none" })', count: 1, reason: "host is a literal" },
      ]
      const exact: ScanItem[] = [
        { path: "pkg/b.mjs", content: 'import { get as httpsGet } from "node:https";\nhttpsGet(url, { redaction: "none" });\n' },
      ]
      expect(evaluateShippedSource(exact, entries)).toEqual({ offenders: [], stale: [] })
      const extra: ScanItem[] = [
        { path: "pkg/b.mjs", content: 'import { get as httpsGet } from "node:https";\nhttpsGet(url, { redaction: "none" });\nhttpsGet({ host, servername: host });\n' },
      ]
      expect(evaluateShippedSource(extra, entries).offenders.length > 0, "new binding call must fail").toBe(true)
      const importPinned: AllowlistEntry[] = [
        { file: "pkg/b.mjs", call: 'import { get as httpsGet } from "node:https"', count: 1, reason: "x" },
      ]
      expect(evaluateShippedSource(exact, importPinned).offenders.length > 0, "pinning an acquisition does not exempt its calls").toBe(true)
    })

    test("#given reformatted calls #when evaluated #then they still match the pinned text", () => {
      const scan: ScanItem[] = [
        { path: "pkg/a.ts", content: "http2.connect(\n  baseUrl,\n);\nhttp2.connect( baseUrl );\n" },
      ]
      expect(evaluateShippedSource(scan, [pinnedCallEntry()])).toEqual({ offenders: [], stale: [] })
    })
  })


  test("#given shipped production source #when scanned #then no raw TLS client call exists outside the reviewed allowlist", () => {
    const files = collectShippedSourceFiles()
    expect(files.length).toBeGreaterThan(1000)
    const scan: ScanItem[] = []
    for (const file of files) {
      const content = readSourceFile(path.join(WORKSPACE_ROOT, file))
      if (content !== null) scan.push({ path: file, content })
    }
    // Built-runtime entries are skipped when no build ran: the omowright
    // runtime is gitignored build output, and CI always builds before
    // running tests, so absence locally means there is nothing to guard.
    const effective = ALLOWLIST.filter(
      (entry) => scan.some((item) => item.path === entry.file) || !isKnownBuiltRuntime(entry.file),
    )
    const verdict = evaluateShippedSource(scan, effective)
    expect(verdict.offenders, OFFENDER_GUIDANCE).toEqual([])
    expect(verdict.stale, STALE_GUIDANCE).toEqual([])
    for (const entry of ALLOWLIST) {
      expect(entry.reason.trim().length > 0, "allowlist entry without a reason: " + entry.file).toBe(true)
    }
  })
})
