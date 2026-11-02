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

function functionSource(name: string): string {
  const start = script.indexOf(`\n${name}() {`)
  const end = script.indexOf("\n}\n", start)
  if (start < 0 || end < 0) throw new Error(`install.sh has no ${name}()`)
  return script.slice(start + 1, end + 2)
}

type Host = {
  /** `ldd --version` output and exit status (musl's ldd exits 1). */
  ldd: { output: string; status: number }
  /** Whether `getconf GNU_LIBC_VERSION` succeeds, as it does only on glibc. */
  glibc: boolean
  /** Whether a /lib/ld-musl-*.so.1 loader is installed. */
  muslLoader: boolean
}

function detectAsset(host: Host): string {
  const root = mkdtempSync(join(tmpdir(), "omo-install-detect-"))
  roots.push(root)
  const bin = join(root, "bin")
  mkdirSync(bin)
  const stub = (name: string, body: string): void => {
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`)
    chmodSync(join(bin, name), 0o755)
  }
  stub("uname", `case "$1" in -s) echo Linux ;; -m) echo x86_64 ;; esac`)
  stub("ldd", `printf '%s\\n' ${JSON.stringify(host.ldd.output)} >&2\nexit ${host.ldd.status}`)
  stub("getconf", host.glibc ? `echo "glibc 2.39"` : `echo "getconf: invalid variable" >&2\nexit 1`)
  stub("ls", host.muslLoader ? "exit 0" : "exit 2")
  for (const name of ["grep", "cat"]) {
    const source = [`/bin/${name}`, `/usr/bin/${name}`].find(existsSync)
    if (source !== undefined) symlinkSync(source, join(bin, name))
  }
  const program = [
    "set -euo pipefail",
    'fail() { printf "fail: %s\\n" "$*" >&2; exit 1; }',
    functionSource("is_musl_libc"),
    functionSource("detect_asset"),
    "detect_asset",
  ].join("\n")
  const bash = ["/bin/bash", "/usr/bin/bash"].find(existsSync) ?? "bash"
  const result = spawnSync(bash, ["-c", program], { encoding: "utf8", env: { PATH: bin } })
  if (result.status !== 0) throw new Error(`detect_asset failed: ${result.stderr}`)
  return result.stdout.trim().replace(/-baseline$/, "")
}

const glibcLdd = { output: "ldd (Ubuntu GLIBC 2.39-0ubuntu8.9) 2.39", status: 0 }
const muslLdd = { output: "musl libc (x86_64)\nVersion 1.2.4", status: 1 }

describe("install.sh detect_asset libc flavor (#10562)", () => {
  test("#given a glibc host with the optional musl package's loader installed #then it picks the glibc build", () => {
    expect(detectAsset({ ldd: glibcLdd, glibc: true, muslLoader: true })).toBe("omo-linux-x64")
  })

  test("#given a plain glibc host #then it picks the glibc build", () => {
    expect(detectAsset({ ldd: glibcLdd, glibc: true, muslLoader: false })).toBe("omo-linux-x64")
  })

  test("#given a musl host whose ldd exits 1 after printing its version #then it picks the musl build", () => {
    expect(detectAsset({ ldd: muslLdd, glibc: false, muslLoader: false })).toBe("omo-linux-x64-musl")
  })

  test("#given a non-glibc host without a recognizable ldd but with the musl loader #then it picks the musl build", () => {
    expect(detectAsset({ ldd: { output: "ldd: not found", status: 127 }, glibc: false, muslLoader: true })).toBe(
      "omo-linux-x64-musl",
    )
  })
})
