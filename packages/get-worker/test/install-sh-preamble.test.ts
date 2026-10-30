import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

const script = readFileSync(join(import.meta.dir, "..", "scripts", "install.sh"), "utf8")
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function sandbox(): { root: string; bin: string } {
  const root = mkdtempSync(join(tmpdir(), "omo-install-preamble-"))
  roots.push(root)
  const bin = join(root, "bin")
  mkdirSync(bin)
  return { root, bin }
}

function linkCommand(bin: string, name: string): void {
  const source = [`/bin/${name}`, `/usr/bin/${name}`].find(existsSync)
  if (source === undefined) throw new Error(`missing test command: ${name}`)
  symlinkSync(source, join(bin, name))
}

describe("install.sh POSIX preamble", () => {
  for (const shell of ["/bin/sh", "/bin/dash"].filter((path) => Bun.file(path).size > 0)) {
    test(`${shell} prints one Bash hint and never parses the Bash body when Bash is unavailable`, () => {
      const { root, bin } = sandbox()
      const result = spawnSync(shell, [], {
        input: script,
        encoding: "utf8",
        env: { HOME: join(root, "home"), PATH: bin, TMPDIR: root },
      })

      expect(result.status).toBe(1)
      expect(result.stdout).toBe("")
      expect(result.stderr).toBe("omo installer: bash is required; run with: curl -fsSL https://get.omo.dev/install.sh | bash\n")
      expect(result.stderr).not.toContain("syntax error")
    })
  }

  test("sh hands every unread line and every argument to Bash", () => {
    const { root, bin } = sandbox()
    linkCommand(bin, "mktemp")
    linkCommand(bin, "rm")
    linkCommand(bin, "cat")
    const captured = join(root, "captured.sh")
    const args = join(root, "args")
    const fakeBash = join(bin, "bash")
    writeFileSync(fakeBash, `#!/bin/sh\ncp "$1" ${JSON.stringify(captured)}\nshift\nprintf '%s\\n' "$@" >${JSON.stringify(args)}\n`)
    chmodSync(fakeBash, 0o755)
    linkCommand(bin, "cp")

    const result = spawnSync("/bin/sh", ["-s", "alpha", "beta"], {
      input: script,
      encoding: "utf8",
      env: { HOME: join(root, "home"), PATH: bin, TMPDIR: root },
    })

    expect(result.status).toBe(0)
    expect(readFileSync(captured, "utf8")).toStartWith("#!/usr/bin/env bash\n# OmO native installer")
    expect(readFileSync(captured, "utf8")).toEndWith('if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then main "$@"; fi\n')
    expect(readFileSync(args, "utf8")).toBe("alpha\nbeta\n")
  })

  test("Bash still parses the wrapper and complete installer body", () => {
    const wrapper = spawnSync("/bin/bash", ["-n"], { input: script, encoding: "utf8" })
    const body = script.split("<<'OMO_INSTALL_BASH'\n", 2)[1]?.split("\nOMO_INSTALL_BASH\n", 1)[0]
    expect(body).toBeDefined()
    const installer = spawnSync("/bin/bash", ["-n"], { input: body, encoding: "utf8" })
    expect(wrapper.status).toBe(0)
    expect(installer.status).toBe(0)
    expect(wrapper.stderr + installer.stderr).toBe("")
  })
})
