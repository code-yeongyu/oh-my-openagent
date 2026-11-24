import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { SessionHostLaunch } from "../../device-service-core/src/index.ts"
import { systemdSessionHostUnit } from "../../device-service-core/src/cold-wake/session-host-unit.ts"
import { omoBinaryPath } from "../remote-bootstrap"

// omo#14258: `omo remote enable` rendered the unit for an OLDER runtime than the omo that ran it when the environment
// carried that older runtime's OMO_BIN (a terminal a live older host spawned keeps it). The omo that ran the command is
// this process whenever this process IS an omo - the compiled binary, or the npm launcher running the verb itself - so
// neither yields to a recorded OMO_BIN; only the engine, which is not an omo, answers through OMO_BIN.

const homes: string[] = []
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

/** The home an older host's environment points back into: its runtime dir, a kept omo-versions install, this CLI's. */
const homeWithRuntimes = (): string => {
  const home = mkdtempSync(join(tmpdir(), "obp-"))
  homes.push(home)
  for (const rel of [
    join(".omo", "binary-runtime", "5.1.72", "omo"),
    join(".omo", "omo-versions", "5.1.77", "omo-ai", "bin", "omo.js"),
    join(".omo", "binary-runtime", "5.1.78", "omo"),
  ]) {
    const file = join(home, rel)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, "", { mode: 0o755 })
  }
  return home
}

describe("the omo a session host unit renders for", () => {
  test("the compiled binary that runs enable, never an older runtime's OMO_BIN the environment carries", () => {
    const home = homeWithRuntimes()
    const current = join(home, ".omo", "binary-runtime", "5.1.78", "omo")
    const older = join(home, ".omo", "binary-runtime", "5.1.72", "omo")
    const omo = omoBinaryPath({ OMO_BIN: older }, { execPath: current, argv1: current, compiled: true })
    expect(omo).toBe(current)
    const unit = systemdSessionHostUnit(
      SessionHostLaunch.from({ omoBin: omo, execPath: current, agentDir: "/srv/profile-b/agent" }),
    )
    expect(unit).toContain(`ExecStart="${current}"`)
  })

  test("the npm launcher running the verb itself, over the same stale OMO_BIN", () => {
    const home = homeWithRuntimes()
    const older = join(home, ".omo", "binary-runtime", "5.1.72", "omo")
    const launcher = join(home, "run", "pkg", "bin", "omo.js")
    mkdirSync(dirname(launcher), { recursive: true })
    writeFileSync(launcher, "", { mode: 0o755 })
    expect(omoBinaryPath({ OMO_BIN: older }, { execPath: "/h/.bun/bin/bun", argv1: launcher })).toBe(launcher)
  })

  // An `npm i -g` install started under node runs through the global bin symlink, and node leaves process.argv[1] as
  // the symlink's own path in the npm prefix, not the omo.js it points at.
  test("the npm launcher reached through a global bin symlink, over the same stale OMO_BIN", () => {
    const home = homeWithRuntimes()
    const older = join(home, ".omo", "binary-runtime", "5.1.72", "omo")
    const launcher = join(home, "prefix", "lib", "node_modules", "omo-ai", "bin", "omo.js")
    mkdirSync(dirname(launcher), { recursive: true })
    writeFileSync(launcher, "", { mode: 0o755 })
    const globalBin = join(home, "prefix", "bin", "omo")
    mkdirSync(dirname(globalBin), { recursive: true })
    symlinkSync(launcher, globalBin)
    expect(omoBinaryPath({ OMO_BIN: older }, { execPath: "/usr/bin/node", argv1: globalBin })).toBe(globalBin)
  })

  test("a global bin symlink to the engine, not an omo, still answers through OMO_BIN", () => {
    const home = homeWithRuntimes()
    const launcher = join(home, ".omo", "omo-versions", "5.1.77", "omo-ai", "bin", "omo.js")
    const engine = join(home, "prefix", "lib", "node_modules", "@code-yeongyu", "senpi", "bin", "cli.js")
    mkdirSync(dirname(engine), { recursive: true })
    writeFileSync(engine, "", { mode: 0o755 })
    const globalBin = join(home, "prefix", "bin", "omo")
    mkdirSync(dirname(globalBin), { recursive: true })
    symlinkSync(engine, globalBin)
    expect(omoBinaryPath({ OMO_BIN: launcher }, { execPath: "/usr/bin/node", argv1: globalBin })).toBe(launcher)
  })

  test("the engine's OMO_BIN, when the process running the verb is the engine, not an omo", () => {
    const home = homeWithRuntimes()
    const launcher = join(home, "run", "pkg", "bin", "omo.js")
    mkdirSync(dirname(launcher), { recursive: true })
    writeFileSync(launcher, "", { mode: 0o755 })
    expect(
      omoBinaryPath(
        { OMO_BIN: launcher },
        { execPath: "/h/.bun/bin/bun", argv1: "/h/lib/@code-yeongyu/senpi/bin/cli.js" },
      ),
    ).toBe(launcher)
  })

  test("no OMO_BIN: the launcher script this process is, as before", () => {
    expect(omoBinaryPath({}, { execPath: "/h/.bun/bin/bun", argv1: "/h/run/pkg/bin/omo.js" })).toBe(
      "/h/run/pkg/bin/omo.js",
    )
  })
})
