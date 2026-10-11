/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { fileURLToPath } from "node:url"

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url))

const INSTALLER_SOURCE_GLOB = "packages/omo-opencode/src/cli/**/*.ts"

const ADDITIONAL_SOURCE_GLOBS = [
  "docs/reference/**/*.md",
  "docs/guide/*.md",
  "docs/legal/*.md",
  "packages/omo-native/bin/**/*.js",
  "packages/omo-senpi/src/components/**/*.ts",
  "packages/web/src/**/*.{ts,tsx,astro,md}",
] as const

const USER_FACING_FILES = [
  "postinstall.mjs",
  "docs/guide/installation.md",
  "README.md",
  "README.ko.md",
  "README.ja.md",
  "README.ru.md",
  "README.zh-cn.md",
] as const

// Each pattern spells "the edition, named after its engine" in one of the five
// languages the README ships in. No allowlist entry may excuse a match.
const BANNED_EDITION_WORDING: readonly RegExp[] = [
  /senpi[\s-]*(?:native[\s-]*)?edition/i,
  /standalone[\s-]*senpi/i,
  /senpi[\s-]*(?:네이티브\s*)?에디션/i,
  /senpi[\s-]*(?:ネイティブ)?エディション/i,
  /senpi[\s-]*(?:native[\s-]*)?редакци/i,
  /senpi[\s-]*(?:원생|原生)?\s*版本/i,
]

const ENGINE_NAME_ALLOWLIST: readonly { readonly why: string; readonly pattern: RegExp }[] = [
  { why: "engine environment variables", pattern: /SENPI_(?:[A-Z0-9_]+|\*)/g },
  { why: "engine state directory", pattern: /[~\w./-]*\.senpi[\w./-]*/g },
  { why: "internal package paths", pattern: /packages\/(?:omo-senpi|senpi-task)[\w./-]*/g },
  {
    why: "engine and internal package names",
    pattern: /@(?:code-yeongyu|oh-my-opencode)\/(?:omo-)?senpi(?:\/[\w-]+)*/g,
  },
  { why: "reviewer agent ids (public contract)", pattern: /omo-senpi-[a-z-]+/g },
  { why: "omo.json harness view id", pattern: /\[senpi\]/g },
  { why: "the engine named as the engine", pattern: /senpi engine/gi },
  { why: "the doctor edition line", pattern: /engine: ?senpi/gi },
  { why: "engine installer export re-exported by install-native-dev", pattern: /runSenpiInstaller/g },
  { why: "engine telemetry reference document", pattern: /senpi-telemetry(?:\.md)?/gi },
  { why: "engine task package, docs, and project state dir", pattern: /senpi-task(?:\.md)?/g },
  { why: "engine telemetry event names", pattern: /omo_senpi_[a-z0-9_]+/g },
  { why: "SENPI_MACHINE_ID_PREFIX value", pattern: /omo-senpi:/g },
  { why: "adapter id in logger prefixes and product identity", pattern: /omo-senpi\b/g },
  { why: "harness-id warning prefix", pattern: /WARN senpi:/g },
  { why: "the engine named possessively", pattern: /senpi's/gi },
  { why: "engine eval execution event", pattern: /senpi\.eval(?:\.[\w.]+)?/g },
  { why: "engine omob runtime slot", pattern: /<senpi\d*>/g },
  { why: "engine git sha stamp", pattern: /senpi@[\w.<>]+/g },
  { why: "engine CLI flag", pattern: /--senpi-[a-z-]+/g },
  { why: "engine GitHub issue references", pattern: /senpi#\d+/g },
  { why: "engine session-id prefix", pattern: /senpi:/g },
  {
    why: "engine named in technical prose",
    pattern: /\bsenpi(?:\s+(?:extension(?:\s+events)?|RPC(?:\s+host)?|release|process(?:es)?|host))/gi,
  },
  { why: "quoted harness id", pattern: /(['"])senpi\1/g },
  { why: "telemetry env prefix (an identifier value the dashboards join on)", pattern: /OMO_SENPI\b/g },
  {
    why: "compound source identifiers such as resolveSenpi or senpiRoot; a bare senpi is deliberately excluded",
    pattern: /\b(?:[A-Za-z]+[Ss]enpi[A-Za-z]*|[Ss]enpi[A-Za-z]+)\b/g,
  },
  {
    // The engine is allowed to be named. What must never pass is the engine being OFFERED to the
    // user as a thing to adopt - that is the edition-by-another-name framing this guard exists to
    // stop, and it is what the can-fail cases below pin.
    why: "the engine as a proper noun, except when offered as a product to adopt",
    pattern: /(?<!\b(?:choose|use|install|try|adopt|switch to|move to|get)\s)\bsenpi(?:'s)?\b/gi,
  },
]

interface Violation {
  readonly file: string
  readonly line: number
  readonly text: string
}

function namesEditionAfterEngine(line: string): boolean {
  return BANNED_EDITION_WORDING.some((pattern) => pattern.test(line))
}

function stripEngineNames(line: string): string {
  let rest = line
  for (const entry of ENGINE_NAME_ALLOWLIST) rest = rest.replace(entry.pattern, "")
  return rest
}

function hasUnallowlistedEngineMention(line: string): boolean {
  return /senpi/i.test(stripEngineNames(line))
}

async function userFacingSources(): Promise<readonly string[]> {
  const sources = new Set<string>(USER_FACING_FILES)
  for (const glob of [INSTALLER_SOURCE_GLOB, ...ADDITIONAL_SOURCE_GLOBS]) {
    for await (const path of new Bun.Glob(glob).scan({ cwd: REPO_ROOT })) {
      if (path.endsWith(".test.ts")) continue
      sources.add(path)
    }
  }
  return [...sources].sort()
}

async function collectViolations(
  detect: (line: string, file: string) => boolean,
): Promise<readonly Violation[]> {
  const violations: Violation[] = []
  for (const file of await userFacingSources()) {
    const contents = await Bun.file(`${REPO_ROOT}${file}`).text()
    contents.split("\n").forEach((text, index) => {
      if (detect(text, file)) violations.push({ file, line: index + 1, text: text.trim().slice(0, 140) })
    })
  }
  return violations
}

function report(violations: readonly Violation[]): string[] {
  return violations.map((violation) => `${violation.file}:${violation.line}  ${violation.text}`)
}

describe("user-facing surfaces call the standalone edition OmO Native", () => {
  test("#given every installer, postinstall, docs, native bin, runtime notice and README surface #when scanned #then none names the edition after the engine", async () => {
    // given / when
    const violations = await collectViolations(namesEditionAfterEngine)

    // then
    expect(report(violations)).toEqual([])
  })

  test("#given every installer, postinstall, docs, native bin, runtime notice and README surface #when scanned #then each remaining senpi mention is an allowlisted engine name", async () => {
    // given / when
    const violations = await collectViolations(hasUnallowlistedEngineMention)

    // then
    expect(report(violations)).toEqual([])
  })
})

describe("the guard itself can fail", () => {
  test.each([
    "**Senpi Edition (standalone, beta)** is the native `omo` command.",
    "a standalone Senpi edition (beta) is available",
    "The senpi-native edition ships as the npm package `omo-ai`.",
    "그 이름은 이제 Senpi 네이티브 에디션의 것입니다.",
    "その名前は Senpi ネイティブエディションのものになりました。",
    "теперь это имя принадлежит senpi-native редакции",
    "这个名字现在归 senpi 原生版本所有",
  ])("#given the banned wording %p #when checked #then it is reported", (line) => {
    // given / when / then
    expect(namesEditionAfterEngine(line)).toBe(true)
  })

  test.each([
    "omo also ships as OmO Native: the same omo as one `omo` command.",
    "Edition: Native · Installed: 5.0.0 (engine: senpi 2026.9.21)",
    "it ships a pinned senpi engine with OMO built in",
    "state under `~/.senpi/agent` when no branded layout exists",
    "chains from `packages/senpi-task/src/agents/builtin/fallback-chains.ts`",
    "harness-specific `[opencode]`, `[senpi]`, and `[codex]` views",
    "the legacy `SENPI_*` and `PI_*` variables are still read when the `OMO_*` one is unset",
  ])("#given the engine-name line %p #when checked #then it is accepted", (line) => {
    // given / when / then
    expect(namesEditionAfterEngine(line)).toBe(false)
    expect(hasUnallowlistedEngineMention(line)).toBe(false)
  })

  test.each([
    "Want one command without a host? Choose senpi (beta).",
    "Want one command without a host? Choose Senpi today.",
    "Install Senpi to get the standalone command.",
  ])("#given the engine offered as a product %p #when checked #then the allowlist does not excuse it", (line) => {
    // given / when / then
    expect(hasUnallowlistedEngineMention(line)).toBe(true)
  })

  test("#given a bare edition mention dressed as prose #when checked #then the allowlist does not excuse it", () => {
    // given
    const line = "Want one command without a host? Choose senpi (beta)."

    // when / then
    expect(hasUnallowlistedEngineMention(line)).toBe(true)
  })
})
