import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { spawnSync } from "node:child_process"

const installer = join(import.meta.dir, "..", "scripts", "install.sh")
const roots: string[] = []

type Fixture = { root: string; home: string; work: string; newOmo: string; oldOmo: string; packageDir: string; unrelated: string; env: Record<string, string> }

function file(path: string, content: string, executable = false): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
  if (executable) chmodSync(path, 0o755)
}

function fixture(failingRemoval = false): Fixture {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "omo-installer-other-")))
  roots.push(root)
  const home = join(root, "home")
  const work = join(root, "work")
  const bunRoot = join(root, "bun")
  const bunBin = join(bunRoot, "bin")
  const packageDir = join(bunRoot, "install", "global", "node_modules", "omo-ai")
  const entry = join(packageDir, "bin", "omo")
  file(join(packageDir, "package.json"), JSON.stringify({ name: "omo-ai", version: "4.0.0", bin: { omo: "bin/omo" } }))
  file(entry, "#!/bin/sh\necho 'omo 4.0.0'\n", true)
  mkdirSync(bunBin, { recursive: true })
  symlinkSync(relative(bunBin, entry), join(bunBin, "omo"))
  const newOmo = join(root, "new-bin", "omo")
  file(newOmo, "#!/bin/sh\necho 'omo 5.0.0'\n", true)
  const tools = join(root, "tools")
  file(join(tools, "bun"), failingRemoval
    ? "#!/bin/sh\nexit 1\n"
    : "#!/bin/sh\nrm -rf \"$BUN_INSTALL/install/global/node_modules/omo-ai\"\nrm -f \"$BUN_INSTALL/bin/omo\"\n", true)
  const unrelated = join(packageDir, "..", "unrelated-package", "keep.txt")
  file(unrelated, "keep\n")
  mkdirSync(work)
  return {
    root, home, work, newOmo, oldOmo: join(bunBin, "omo"), packageDir, unrelated,
    env: { HOME: home, PATH: `${dirname(newOmo)}:${bunBin}:${tools}:/usr/bin:/bin`, OMO_INSTALL_SOURCE_ONLY: "1" },
  }
}

function report(f: Fixture, body: string, input?: string) {
  return spawnSync("/bin/bash", ["-c", `source ${JSON.stringify(installer)}\n${body}`], {
    input, encoding: "utf8", env: f.env,
  })
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("install.sh other-install handling", () => {
  test("accepting the interactive prompt removes the bun-global install and leaves one omo on PATH", () => {
    const f = fixture()
    const result = report(f, `is_interactive() { return 0; }\nreport_other_installs ${JSON.stringify(f.newOmo)} 0 ${JSON.stringify(f.work)}\ntype -ap omo`, "yes\n")

    expect(result.status).toBe(0)
    expect(result.stderr).toContain(`Remove the other omo install at ${f.oldOmo}? [y/N]`)
    expect(result.stderr).toContain(`Removed the other omo install at ${f.oldOmo}.`)
    expect(result.stdout.trim().split("\n")).toEqual([f.newOmo])
    expect(existsSync(f.packageDir)).toBe(false)
    expect(readFileSync(f.unrelated, "utf8")).toBe("keep\n")
  })

  test("a non-interactive run never deletes without the explicit flag", () => {
    const f = fixture()
    const result = report(f, `is_interactive() { return 1; }\nreport_other_installs ${JSON.stringify(f.newOmo)} 0 ${JSON.stringify(f.work)}`)

    expect(result.status).toBe(0)
    expect(result.stderr).toContain("Nothing was removed in this non-interactive run. Re-run with --remove-other-installs")
    expect(readFileSync(join(f.packageDir, "package.json"), "utf8")).toContain('"name":"omo-ai"')
    expect(readFileSync(f.unrelated, "utf8")).toBe("keep\n")
  })

  test("the explicit flag removes only the verified omo package and shim", () => {
    const f = fixture()
    const lookalike = join(dirname(f.oldOmo), "omo-helper")
    file(lookalike, "unrelated\n")
    const result = report(f, `report_other_installs ${JSON.stringify(f.newOmo)} 1 ${JSON.stringify(f.work)}`)

    expect(result.status).toBe(0)
    expect(existsSync(f.oldOmo)).toBe(false)
    expect(existsSync(join(f.packageDir, "package.json"))).toBe(false)
    expect(readFileSync(lookalike, "utf8")).toBe("unrelated\n")
    expect(readFileSync(f.unrelated, "utf8")).toBe("keep\n")
  })

  test("declining the prompt changes nothing on disk", () => {
    const f = fixture()
    const before = readFileSync(join(f.packageDir, "package.json"), "utf8")
    const result = report(f, `is_interactive() { return 0; }\nreport_other_installs ${JSON.stringify(f.newOmo)} 0 ${JSON.stringify(f.work)}`, "no\n")

    expect(result.status).toBe(0)
    expect(result.stderr).toContain("Kept it. Remove it later with:")
    expect(readFileSync(join(f.packageDir, "package.json"), "utf8")).toBe(before)
    expect(readFileSync(f.unrelated, "utf8")).toBe("keep\n")
  })

  test("a failed removal leaves the new install working and prints the exact command", () => {
    const f = fixture(true)
    const result = report(f, `report_other_installs ${JSON.stringify(f.newOmo)} 1 ${JSON.stringify(f.work)}\n${JSON.stringify(f.newOmo)} --version`)

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("omo 5.0.0")
    expect(result.stderr).toContain("the new install still works")
    expect(result.stderr).toContain(`BUN_INSTALL=${f.root}/bun bun remove -g omo-ai`)
    expect(readFileSync(join(f.packageDir, "package.json"), "utf8")).toContain('"name":"omo-ai"')
  })

  test("an unverified look-alike omo is never removed", () => {
    const f = fixture()
    rmSync(f.oldOmo)
    const foreign = join(dirname(f.oldOmo), "omo")
    file(foreign, "#!/bin/sh\necho look-alike\n", true)
    const result = report(f, `report_other_installs ${JSON.stringify(f.newOmo)} 1 ${JSON.stringify(f.work)}`)

    expect(result.status).toBe(0)
    expect(result.stderr).toContain("could not be verified, so nothing was removed")
    expect(readFileSync(foreign, "utf8")).toContain("look-alike")
    expect(readFileSync(f.unrelated, "utf8")).toBe("keep\n")
  })

  test("a prior standalone receipt permits removing only that old launcher", () => {
    const f = fixture()
    rmSync(f.oldOmo)
    const oldStandalone = join(dirname(f.oldOmo), "omo")
    file(oldStandalone, "#!/bin/sh\necho 'omo 3.0.0'\n", true)
    file(join(f.home, ".omo", "install.json"), JSON.stringify({ method: "standalone", binPath: oldStandalone }))
    const neighbor = join(dirname(oldStandalone), "keep")
    file(neighbor, "keep\n")
    const result = report(f, `report_other_installs ${JSON.stringify(f.newOmo)} 1 ${JSON.stringify(f.work)}`)

    expect(result.status).toBe(0)
    expect(existsSync(oldStandalone)).toBe(false)
    expect(readFileSync(neighbor, "utf8")).toBe("keep\n")
  })
})
