import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

const script = readFileSync(join(import.meta.dir, "..", "scripts", "install.sh"), "utf8")
const bash = ["/bin/bash", "/usr/bin/bash"].find(existsSync) ?? "bash"
const pipelineOverride = "curl -fsSL https://get.omo.dev/install.sh | OMO_INSTALL_ALLOW_SUDO=1 bash"
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function functionSource(name: string): string {
  const start = script.indexOf(`\n${name}() {`)
  const end = script.indexOf("\n}\n", start)
  if (start < 0 || end < 0) throw new Error(`install.sh has no ${name}()`)
  return script.slice(start + 1, end + 2)
}

function hostBin(uid: number, stubs: Record<string, string> = {}, real: string[] = []): { root: string; bin: string } {
  const root = mkdtempSync(join(tmpdir(), "omo-install-root-guard-"))
  roots.push(root)
  const bin = join(root, "bin")
  mkdirSync(bin)
  for (const [name, body] of Object.entries({ id: `[ "$1" = -u ] && echo ${uid}`, ...stubs })) {
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`)
    chmodSync(join(bin, name), 0o755)
  }
  for (const name of real) {
    const source = [`/bin/${name}`, `/usr/bin/${name}`].find(existsSync)
    if (source === undefined) throw new Error(`missing test command: ${name}`)
    symlinkSync(source, join(bin, name))
  }
  return { root, bin }
}

type Env = Record<string, string>

function guard(uid: number, env: Env = {}): { status: number | null; stderr: string } {
  const { bin } = hostBin(uid)
  const program = [
    "set -euo pipefail",
    'say() { printf "%s\\n" "$*" >&2; }',
    'fail() { say "omo installer: $*"; exit 1; }',
    functionSource("refuse_sudo_install"),
    "refuse_sudo_install",
    "echo allowed >&2",
  ].join("\n")
  const result = spawnSync(bash, ["-c", program], { encoding: "utf8", env: { PATH: bin, ...env } })
  return { status: result.status, stderr: result.stderr }
}

describe("install.sh root guard (#14344)", () => {
  test("#given a normal user #then it installs", () => {
    expect(guard(1000)).toEqual({ status: 0, stderr: "allowed\n" })
  })

  test("#given a root-only shell with no sudo (proot-distro, containers) #then it installs without an override", () => {
    expect(guard(0)).toEqual({ status: 0, stderr: "allowed\n" })
  })

  test("#given root that sudo started from root itself #then it installs", () => {
    expect(guard(0, { SUDO_USER: "root" })).toEqual({ status: 0, stderr: "allowed\n" })
  })

  test("#given sudo from a normal user #then it refuses and prints the pipeline-form override", () => {
    const result = guard(0, { SUDO_USER: "alice" })
    expect(result.status).toBe(1)
    expect(result.stderr).not.toContain("allowed")
    expect(result.stderr).toContain("alice")
    expect(result.stderr).toContain(pipelineOverride)
  })

  test("#given doas from a normal user #then it refuses too", () => {
    const result = guard(0, { DOAS_USER: "alice" })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(pipelineOverride)
  })

  test("#given sudo from a normal user with OMO_INSTALL_ALLOW_SUDO=1 #then it installs", () => {
    expect(guard(0, { SUDO_USER: "alice", OMO_INSTALL_ALLOW_SUDO: "1" })).toEqual({ status: 0, stderr: "allowed\n" })
  })
})

describe("install.sh main applies the root guard (#14344)", () => {
  // `uname -s` names an unsupported OS so main stops at detect_asset, right after the guard, with no network.
  function runInstaller(uid: number, env: Env): { status: number | null; stderr: string } {
    const { root, bin } = hostBin(uid, { uname: "echo Plan9" }, ["bash", "mktemp", "cat", "rm"])
    const result = spawnSync(bash, ["-s"], {
      input: script,
      encoding: "utf8",
      env: { HOME: join(root, "home"), PATH: bin, TMPDIR: root, ...env },
    })
    return { status: result.status, stderr: result.stderr }
  }

  test("#given a root-only shell #then main passes the guard", () => {
    const result = runInstaller(0, {})
    expect(result.stderr).toBe("omo installer: unsupported operating system Plan9\n")
    expect(result.status).toBe(1)
  })

  test("#given sudo from a normal user #then main refuses before detecting the platform", () => {
    const result = runInstaller(0, { SUDO_USER: "alice" })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(pipelineOverride)
    expect(result.stderr).not.toContain("unsupported operating system")
  })
})
