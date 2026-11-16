// Architecture contract G2 (design one-remote-module v8-core r2, omo#13414): the `omo remote` and `omo thread` CLI files
// may import only the remote module's person entry and types, their own args/render/exit helpers and `node:*`; every
// other import is an offender listed below with the PR that removes it. The list may only shrink: a new import outside
// the rule fails, and so does a listed offender that no longer exists (remove its line in the PR that fixes it).
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const NATIVE = join(import.meta.dir, "..")

const OFFENDERS: readonly string[] = [
  // Infrastructure callers that stay CLI-side (design Appendix A: sign-in hand-off, enable, cold wake, the account read).
  "remote-cold-wake.ts -> ../device-service-core/src/index.ts",
  "remote-entry.ts -> ../device-service-core/src/device-service.ts",
  "remote-entry.ts -> ../omo-opencode/src/cli/service-auth/keystore",
  "remote-entry.ts -> ./account-show",
  "remote-entry.ts -> ./bin/lib/agent-dir.js",
  "remote-entry.ts -> ./device-service-handoff",
  "remote-local.ts -> ../device-service-core/src/account-state.ts",
  "remote-local.ts -> ../device-service-core/src/device-service.ts",
  "remote-local.ts -> ./account-show",
  "remote-local.ts -> ./package.json",
  "remote-permission-preset.ts -> ./bin/lib/agent-dir.js",
  "remote-permission-preset.ts -> ./bin/lib/jsonc.js",
  "remote-session-verbs.ts -> ../omo-senpi/src/components/thread/gateway/store",
  "remote-session-verbs.ts -> ./bin/lib/package-paths.js",
  // U2 (#13414): the attach endpoint moves into components/remote/attach.ts.
  "remote-attach.ts -> ../omo-senpi/src/components/thread/remote/outcome",
  // 4c-3: the bootstrap internal entry takes service.bootstrap on the service client.
  "remote-bootstrap.ts -> ../device-service-core/src/index.ts",
  "remote-bootstrap.ts -> ./package.json",
]

const allowed = (specifier: string): boolean =>
  specifier.startsWith("node:") ||
  /^\.\/(remote-[\w-]+|thread-[\w-]+\.js)$/.test(specifier) ||
  /^\.\.\/omo-senpi\/src\/components\/remote\/(client|types|seams)$/.test(specifier)

function cliFiles(): string[] {
  const remote = readdirSync(NATIVE).filter((name) => /^remote-.*\.ts$/.test(name) && !name.endsWith(".test.ts"))
  const thread = readdirSync(join(NATIVE, "bin", "lib"))
    .filter((name) => /^thread.*\.js$/.test(name))
    .map((name) => `bin/lib/${name}`)
  return [...remote, ...thread]
}

// Bun's transpiler drops type-only imports, which the rule exempts.
function violations(): string[] {
  const found: string[] = []
  for (const file of cliFiles()) {
    const transpiler = new Bun.Transpiler({ loader: file.endsWith(".js") ? "js" : "ts" })
    for (const entry of transpiler.scanImports(readFileSync(join(NATIVE, file), "utf8")))
      if (!allowed(entry.path)) found.push(`${file} -> ${entry.path}`)
  }
  return found.sort()
}

describe("omo remote / omo thread CLI imports (G2)", () => {
  test("#given the CLI files #when their imports are scanned #then only the listed offenders break the rule", () => {
    expect(cliFiles()).toContain("remote-local.ts")
    expect(cliFiles()).toContain("bin/lib/thread.js")
    expect(violations()).toEqual([...OFFENDERS].sort())
  })

  test("#given the scanner #when a forbidden import is present #then it is reported", () => {
    const transpiler = new Bun.Transpiler({ loader: "ts" })
    const scanned = transpiler
      .scanImports('import { x } from "../omo-senpi/src/components/thread/remote/remote-ops"\nexport const y = x')
      .map((entry) => entry.path)
    expect(scanned.filter((path) => !allowed(path))).toEqual(["../omo-senpi/src/components/thread/remote/remote-ops"])
  })
})
