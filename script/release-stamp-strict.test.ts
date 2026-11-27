/// <reference types="bun-types" />

// Release contract (#14847): a release-state pull request may skip the macOS/Windows matrix only when its stamp commit
// changes nothing but versions over the pinned source. release-stamp-strict.mjs is that proof: one case per rule.

import { afterAll, expect, test } from "bun:test"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const checker = fileURLToPath(new URL("./release-stamp-strict.mjs", import.meta.url))
const root = mkdtempSync(join(tmpdir(), "release-stamp-strict-"))
afterAll(() => rmSync(root, { recursive: true, force: true }))

const manifest = (version: string, extra: Record<string, unknown> = {}) =>
  `${JSON.stringify({ name: "oh-my-opencode", version, optionalDependencies: { "oh-my-opencode-linux-x64": version }, ...extra }, null, 2)}\n`
const native = (version: string) => `${JSON.stringify({ name: "omo-ai", version }, null, 2)}\n`
const lock = (rootVersion: string, ky: string, dependencies: string[] = [], packagesHeader = '  "packages": {') =>
  [
    "{",
    '  "lockfileVersion": 1,',
    '  "workspaces": {',
    '    "": {',
    '      "name": "oh-my-opencode",',
    `      "version": "${rootVersion}",`,
    ...(dependencies.length > 0 ? ['      "optionalDependencies": {', ...dependencies, "      },"] : []),
    "    },",
    "  },",
    packagesHeader,
    `    "ky": ["ky@${ky}", "", {}, "sha512-${ky}"],`,
    "  },",
    "}",
    "",
  ].join("\n")
const bundle = (source: string, body: string, code: string) => `// omo:${source}:${body}\n${code}\n`

const pin: Record<string, string> = {
  "package.json": manifest("5.1.81"),
  "packages/omo-native/package.json": native("5.1.81"),
  "bun.lock": lock("5.1.81", "1.2.3"),
  "packages/omo-senpi/plugin/extensions/omo.js": bundle("SRC81", "BODY", 'export const v = "5.1.81"'),
  "CHANGELOG.md": "# old\n",
}
const stamp: Record<string, string> = {
  ...pin,
  "package.json": manifest("5.1.82"),
  "packages/omo-native/package.json": native("5.1.82"),
  "bun.lock": lock("5.1.82", "1.2.3"),
  "packages/omo-senpi/plugin/extensions/omo.js": bundle("SRC82", "BODY82", 'export const v = "5.1.82"'),
  "CHANGELOG.md": "# 5.1.82\n\nanything at all\n",
}

function judge(name: string, change: Record<string, string>, pinChange: Record<string, string> = {}, via = checker) {
  const repo = join(root, name)
  mkdirSync(repo, { recursive: true })
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo, encoding: "utf8" }).trim()
  const write = (files: Record<string, string>) => {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(repo, dirname(path)), { recursive: true })
      writeFileSync(join(repo, path), text)
    }
  }
  git("init", "-q")
  write({ ...pin, ...pinChange })
  git("add", "-A")
  git("commit", "-qm", "pin")
  write({ ...stamp, ...change })
  git("add", "-A")
  git("commit", "-qm", "stamp")
  return spawnSync("node", [via, git("rev-parse", "HEAD~1"), git("rev-parse", "HEAD")], {
    cwd: repo,
    encoding: "utf8",
  })
}

test("#given a stamp that changes only versions, a bundle's marker digests and prose #then it is a stamp", () => {
  const run = judge("pure", {})
  expect(run.stderr).toBe("")
  expect(run.status).toBe(0)
  expect(run.stdout).toBe("STRICT_STAMP_OK\n")
})

test("#given the checker is run through a symlinked path #then it still judges and prints its sentinel", () => {
  const link = join(root, "linked-release-stamp-strict.mjs")
  symlinkSync(checker, link)
  const run = judge("symlinked", {}, {}, link)
  expect(run.stderr).toBe("")
  expect(run.stdout).toBe("STRICT_STAMP_OK\n")
  const refused = judge("symlinked-refused", { "packages/omo-native/src/cli.ts": "export {}\n" }, {}, link)
  expect(refused.status).toBe(1)
  expect(refused.stdout).toBe("")
})

// JSON.parse keeps the last of duplicate keys while bun reads the first, so a manifest must equal the pin's text with only
// its version strings replaced; formatting is part of the bytes.
test.each([
  [
    "a package.json with duplicate keys that parse like the pin",
    `{"name":"oh-my-opencode","version":"5.1.82","optionalDependencies":{"oh-my-opencode-linux-x64":"5.1.82"},"type":"commonjs","type":"module","scripts":{"postinstall":"echo X"},"scripts":{}}\n`,
  ],
  [
    "a package.json reformatted without other changes",
    `${JSON.stringify({ name: "oh-my-opencode", version: "5.1.82", optionalDependencies: { "oh-my-opencode-linux-x64": "5.1.82" }, type: "module", scripts: {} })}\n`,
  ],
] as const)("#given %s #then it is refused", (name, text) => {
  const run = judge(
    `manifest-${name.length}`,
    { "package.json": text },
    {
      "package.json": manifest("5.1.81", { type: "module", scripts: {} }),
    },
  )
  expect(run.status).toBe(1)
  expect(run.stderr).toContain("package.json")
  expect(run.stdout).toBe("")
})

// bun.lock: only a workspace's own version line, and our platform packages pinned to the stamp version, may move.
test.each([
  [
    "a workspace dependency named version whose range moved",
    lock("5.1.81", "1.2.3", ['        "version": "^1.0.0",']),
    lock("5.1.82", "1.2.3", ['        "version": "^2.0.0",']),
  ],
  [
    "a platform package dependency moved to a URL",
    lock("5.1.81", "1.2.3", ['        "oh-my-opencode-linux-x64": "5.1.81",']),
    lock("5.1.82", "1.2.3", ['        "oh-my-opencode-linux-x64": "https://example.invalid/x.tgz",']),
  ],
  [
    "a lockfile without its packages header",
    lock("5.1.81", "1.2.3", [], '  "packages":  {').replace(
      '"ky": ["ky@1.2.3", "", {}, "sha512-1.2.3"],',
      '"ky": {\n      "version": "1.2.3",',
    ),
    lock("5.1.82", "1.2.3", [], '  "packages":  {').replace(
      '"ky": ["ky@1.2.3", "", {}, "sha512-1.2.3"],',
      '"ky": {\n      "version": "9.9.9",',
    ),
  ],
] as const)("#given %s #then it is refused", (name, pinLock, stampLock) => {
  const run = judge(`lock-${name.length}`, { "bun.lock": stampLock }, { "bun.lock": pinLock })
  expect(run.status).toBe(1)
  expect(run.stderr).toContain("bun.lock")
  expect(run.stdout).toBe("")
})

test.each([
  ["a package.json field other than version", "package.json", manifest("5.1.82", { main: "other.js" })],
  ["an external dependency bump in bun.lock", "bun.lock", lock("5.1.82", "1.2.4")],
  [
    "a bundle whose marker changed its tag",
    "packages/omo-senpi/plugin/extensions/omo.js",
    `// other:SRC82:BODY82\nexport const v = "5.1.82"\n`,
  ],
  [
    "a bundle whose code changed beyond the version",
    "packages/omo-senpi/plugin/extensions/omo.js",
    bundle("SRC82", "BODY82", 'export const v = "5.1.82"; run()'),
  ],
  ["a source file", "packages/omo-native/src/cli.ts", "export {}\n"],
] as const)("#given %s #then it is refused and the path is named", (_name, path, text) => {
  const run = judge(path.replace(/\W/g, "-") + _name.length, { [path]: text })
  expect(run.status).toBe(1)
  expect(run.stderr).toContain(path)
})
