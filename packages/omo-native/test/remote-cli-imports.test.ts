// Architecture contract G2 (design one-remote-module v8-core r2, omo#13414): the `omo remote` and `omo thread` CLI files
// may import only the remote module's public entry (components/remote/index: the person factory) and its types module, their own args/render/exit helpers and `node:*`; every
// other import is an offender listed below with the PR that removes it. The list may only shrink: a new import outside
// the rule fails, and so does a listed offender that no longer exists (remove its line in the PR that fixes it).
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const NATIVE = join(import.meta.dir, "..")

const OFFENDERS: readonly string[] = [
  // 4c-1 leaves these: `enable` and the session verbs still run on their own connection.
  "remote-cli.ts -> ../device-service-core/src/index.ts",
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
  // 4c-2: the session verbs and attach move onto sessions.* and attach().
  "remote-attach-dialogs.ts -> ../omo-senpi/src/components/thread/remote/dialog-mirror",
  "remote-attach-presentation.ts -> ../omo-senpi/src/components/thread/remote/outcome",
  "remote-cli.ts -> ../omo-senpi/src/components/remote/port/device-service",
  "remote-opt-out.ts -> ./bin/lib/agent-dir.js",
  "remote-permission-preset.ts -> ../omo-senpi/src/components/thread/contracts/permission-presets",
  "remote-session-args.ts -> ../omo-senpi/src/components/thread/contracts/fields",
  "remote-session-target.ts -> ../omo-senpi/src/components/thread/errors",
  "remote-session-target.ts -> ../omo-senpi/src/components/thread/remote/address-book",
  "remote-session-verbs.ts -> ../omo-senpi/src/components/thread/remote/ports",
  "remote-session-verbs.ts -> ../omo-senpi/src/components/remote/port/device-service",
  "remote-session-verbs.ts -> ../omo-senpi/src/components/thread/control/operations",
  "remote-session-verbs.ts -> ../omo-senpi/src/components/thread/control/relay-control",
  "remote-session-verbs.ts -> ../omo-senpi/src/components/thread/control/relay-session-host",
  "remote-session-verbs.ts -> ../omo-senpi/src/components/thread/gateway/engine",
  "remote-session-verbs.ts -> ../omo-senpi/src/components/thread/gateway/local-transport",
  "remote-session-verbs.ts -> ../omo-senpi/src/components/thread/gateway/pipeline",
  "remote-session-verbs.ts -> ../omo-senpi/src/components/thread/gateway/provenance-resolver",
  "remote-session-verbs.ts -> ../omo-senpi/src/components/thread/gateway/store",
  "remote-session-verbs.ts -> ../omo-senpi/src/components/thread/remote/address-book",
  "remote-session-verbs.ts -> ../omo-senpi/src/components/thread/remote/relay-transport",
  "remote-session-verbs.ts -> ../omo-senpi/src/components/thread/remote/remote-ops",
  "remote-session-verbs.ts -> ../omo-senpi/src/components/thread/remote/this-device",
  "remote-session-verbs.ts -> ../omo-senpi/src/components/thread/thread-link",
  "remote-session-verbs.ts -> ../omo-senpi/src/components/thread/tools/thread-row",
  "remote-session-verbs.ts -> ./bin/lib/agent-dir.js",
  "remote-session-verbs.ts -> ./bin/lib/package-paths.js",
  // 4c-3: the bootstrap internal entry takes service.bootstrap on the service client.
  "remote-bootstrap.ts -> ../device-service-core/src/index.ts",
  "remote-bootstrap.ts -> ./package.json",
]

// This device's operator endpoint leg opens sockets, so remote-cli loads it lazily, never into remote-local's local-only
// graph (omo#13440): allowed only as a dynamic import from remote-cli.ts.
const LAZY: ReadonlySet<string> = new Set(["remote-cli.ts -> ../omo-senpi/src/components/remote/local-sessions"])

const allowed = (specifier: string): boolean =>
  specifier.startsWith("node:") ||
  /^\.\/(remote-[\w-]+|thread-[\w-]+\.js)$/.test(specifier) ||
  /^\.\.\/omo-senpi\/src\/components\/remote\/(index|types)$/.test(specifier)

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
      if (!allowed(entry.path) && !(entry.kind === "dynamic-import" && LAZY.has(`${file} -> ${entry.path}`)))
        found.push(`${file} -> ${entry.path}`)
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
