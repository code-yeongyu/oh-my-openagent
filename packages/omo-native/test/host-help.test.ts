import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const native = resolve(import.meta.dir, "..")
const commands = {
  daemon: ["run", "adopt", "status", "stop", "handoff", "gc", "rollback-prepare"],
  host: ["ensure", "handoff", "status", "stop", "gc", "shard-path", "session"],
}

for (const [family, verb] of [
  ["daemon", "run"],
  ["daemon", "handoff"],
  ["host", "ensure"],
  ["host", "handoff"],
]) {
  test(`${family} ${verb} refuses an unknown flag with usage`, () => {
    const home = mkdtempSync(join(tmpdir(), "bad-host-option-"))
    try {
      const result = spawnSync("node", [join(native, "bin/omo.js"), family, verb, "--typo"], {
        cwd: home,
        encoding: "utf8",
        env: { HOME: home, PATH: process.env.PATH, OMO_RUNTIME: "node" },
      })
      expect(result.status, result.stderr).toBe(2)
      expect(result.stderr.toLowerCase()).toContain("usage:")
      expect(result.stderr).toContain("--typo")
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
}

for (const entry of ["npm", "compiled"]) {
  for (const [family, verbs] of Object.entries(commands)) {
    for (const verb of verbs) {
      test(`${entry}: ${family} ${verb} answers help before runtime selection or trust`, () => {
        const home = mkdtempSync(join(tmpdir(), "host-help-"))
        try {
          const guard = join(home, "guard.cjs")
          writeFileSync(
            guard,
            `
        const deny = () => { process.stderr.write("UNEXPECTED HOST I/O\\n"); process.exit(79) }
        const cp = require("node:child_process")
        for (const name of ["spawn", "spawnSync", "exec", "execFile", "fork"]) cp[name] = deny
        require("node:net").Socket.prototype.connect = deny
        process.execve = deny
        require("node:module").syncBuiltinESMExports()
      `,
          )
          const invoke = (...args: string[]) =>
            spawnSync(
              entry === "npm" ? "node" : process.execPath,
              entry === "npm"
                ? ["--require", guard, join(native, "bin/omo.js"), ...args]
                : ["--preload", guard, join(native, "compile-entry.ts"), ...args],
              {
                cwd: home,
                encoding: "utf8",
                env: {
                  HOME: home,
                  PATH: process.env.PATH,
                  OMO_RUNTIME: "bun",
                  OMO_EXTRA_CA_CERTIFICATES: "invalid-relative-path",
                },
              },
            )
          for (const args of [
            [family, verb, "--json", "--help"],
            [family, "-h", verb],
          ]) {
            const result = invoke(...args)
            expect(result.status, `${args.join(" ")}: ${result.stderr}`).toBe(0)
            expect(result.stdout).toContain(`usage: omo ${family}`)
            expect(result.stderr).not.toContain("UNEXPECTED HOST I/O")
          }
        } finally {
          rmSync(home, { recursive: true, force: true })
        }
      })
    }
  }
}
