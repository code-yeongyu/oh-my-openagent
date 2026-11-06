import { describe, expect, test } from "bun:test"
import { spawn, spawnSync } from "node:child_process"
import { once } from "node:events"
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { Socket } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

const SOURCE = resolve(import.meta.dir, "..")

describe.skipIf(process.platform !== "win32")("Windows launcher pipe pair (#11955)", () => {
  for (const hop of ["npm", "bun-reexec", "compiled"] as const) {
    test(`${hop} host ensure round-trips a frame and releases both parent handles before exit`, async () => {
      const root = mkdtempSync(join(tmpdir(), "omo-win32-pair-"))
      const pkg = join(root, "app")
      const engine = join(pkg, "node_modules", "@code-yeongyu", "senpi")
      let child: ReturnType<typeof spawn> | undefined
      try {
        mkdirSync(join(engine, "dist", "core"), { recursive: true })
        cpSync(join(SOURCE, "bin"), join(pkg, "bin"), { recursive: true })
        writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "omo-ai", version: "0.0.0-test", type: "module" }))
        writeFileSync(join(engine, "package.json"), JSON.stringify({
          name: "@code-yeongyu/senpi", version: "0.0.0-test", type: "module", exports: { ".": "./dist/index.js" },
        }))
        writeFileSync(join(engine, "dist", "index.js"), "export {}\n")
        writeFileSync(join(engine, "dist", "core", "brand.js"), "export {}\n")
        // This stand-in models an installed, prepared engine. It deliberately has no
        // provider/RPC implementation for postinstall to patch.
        writeFileSync(join(engine, ".omo-engine-prepared"), "0.0.0-test\n")
        const entry = join(engine, "dist", "cli.js")
        writeFileSync(entry, `
import { createReadStream, createWriteStream, fstatSync } from "node:fs"
if (process.env.SENPI_PRIVATE_FDS !== '{"a":[5,6]}') {
  throw new Error("pair lost at launcher hop: " + JSON.stringify({ hop: ${JSON.stringify(hop)}, table: process.env.SENPI_PRIVATE_FDS ?? null, bun: process.versions.bun ?? null }))
}
const input = createReadStream("", { fd: 5, autoClose: true })
const output = createWriteStream("", { fd: 6, autoClose: true })
let frame = ""
let pending = 2
input.on("data", chunk => { frame += chunk.toString() })
input.on("end", () => output.end("echo:" + frame))
for (const stream of [input, output]) stream.on("close", () => {
  if (--pending !== 0) return
  const closed = [5, 6].map(fd => {
    try { fstatSync(fd); return false } catch (error) { return error.code === "EBADF" }
  })
  process.stdin.on("end", () => console.log(JSON.stringify({ closed })))
  process.stdin.resume()
})
`)
        let command = process.execPath
        let args = [join(pkg, "bin", "omo.js"), "host", "ensure"]
        if (hop === "npm" || hop === "bun-reexec") {
          const node = Bun.which("node")
          if (node === null) throw new Error("Windows launcher proof requires real Node")
          command = node
        } else {
          const probe = join(root, "handoff.ts")
          writeFileSync(probe, `
import { reexecProvisionedRuntime } from ${JSON.stringify(join(SOURCE, "provisioned-handoff.ts"))}
await reexecProvisionedRuntime(process.env.PAIR_BUN, { argv: [${JSON.stringify(entry)}, "host", "ensure"] })
`)
          command = join(root, "handoff.exe")
          const build = spawnSync(process.execPath, ["build", "--compile", probe, "--outfile", command], { encoding: "utf8" })
          expect(build.status, build.stderr).toBe(0)
          args = []
        }
        child = spawn(command, args, {
          env: {
            ...process.env,
            PATH: `${dirname(process.execPath)};${process.env.PATH ?? ""}`,
            OMO_RUNTIME: hop === "npm" ? "node" : "bun",
            OMO_CODING_AGENT_DIR: join(root, "agent"),
            SENPI_PRIVATE_FDS: '{"a":[5,6]}',
            PAIR_BUN: process.execPath,
          },
          stdio: ["pipe", "pipe", "pipe", "ignore", "ignore", "pipe", "pipe"],
        })
        const exited = once(child, "close", { signal: AbortSignal.timeout(30_000) })
        const slots: readonly unknown[] = child.stdio
        const input = slots[5]
        const output = slots[6]
        if (!(input instanceof Socket) || !(output instanceof Socket)) throw new Error("missing private pipes")
        const inputClosed = once(input, "close", { signal: AbortSignal.timeout(30_000) })
        const outputEnded = once(output, "end", { signal: AbortSignal.timeout(30_000) })
        let received = ""
        let report = ""
        let errors = ""
        output.on("data", (chunk: Buffer) => { received += chunk.toString() })
        child.stdout?.on("data", (chunk: Buffer) => { report += chunk.toString() })
        child.stderr?.on("data", (chunk: Buffer) => { errors += chunk.toString() })
        // Listeners are registered before sending the frame. EOF proves that the waiting launcher
        // no longer owns either pipe, not merely that it eventually closes them on process exit.
        input.end("ping")
        await Promise.all([inputClosed, outputEnded])
        expect(received, errors).toBe("echo:ping")
        expect(child.exitCode).toBeNull()
        child.stdin?.end()
        expect((await exited)[0], errors).toBe(0)
        expect(JSON.parse(report)).toEqual({ closed: [true, true] })
      } finally {
        if (child?.exitCode === null && child.signalCode === null) {
          const stopped = once(child, "close", { signal: AbortSignal.timeout(10_000) })
          child.stdin?.end()
          child.kill()
          await stopped
        }
        rmSync(root, { recursive: true, force: true })
      }
    }, 150_000)
  }
})
