import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { senpiWorkerCompileArgs } from "./senpi-worker-compile"

test.each(["directory", "bun-link", "external-link"])("#given a %s worker engine #when compiled and relocated #then two workers start without source files", (layout) => {
  const scratch = mkdtempSync(join(tmpdir(), "omo-worker-compile-"))
  try {
    // given: mirror the published engine layout and compile-time worker contract.
    const buildRoot = join(scratch, "build")
    const root = join(buildRoot, "source")
    const packagePath = join(root, "node_modules/@code-yeongyu/senpi")
    const physicalPackage = layout === "directory" ? packagePath : layout === "bun-link"
      ? join(root, "node_modules/.bun/senpi/node_modules/@code-yeongyu/senpi")
      : join(buildRoot, "engine")
    mkdirSync(join(physicalPackage, "dist/modes/rpc"), { recursive: true })
    if (layout !== "directory") {
      mkdirSync(dirname(packagePath), { recursive: true })
      symlinkSync(physicalPackage, packagePath, "junction")
    }
    const worker = join(packagePath, "dist/modes/rpc/session-worker.js")
    writeFileSync(worker, `import { parentPort } from "node:worker_threads"; parentPort.postMessage("ready");`)
    const entry = join(root, "entry.ts")
    writeFileSync(entry, `import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
const path = typeof SENPI_RPC_SESSION_WORKER_ENTRY === "string" ? SENPI_RPC_SESSION_WORKER_ENTRY : "./src/modes/rpc/session-worker.ts";
await Promise.all([1, 2].map(() => new Promise((resolve, reject) => {
  const worker = new Worker(fileURLToPath(new URL(path, import.meta.url)).replaceAll("\\\\", "/"));
  worker.once("error", reject);
  worker.once("message", async (message) => { await worker.terminate(); resolve(message); });
})));
console.log("two-workers-ready");`)
    const binary = join(scratch, process.platform === "win32" ? "omo.exe" : "omo")
    // when: use the same args as the release builder, then remove the entire source.
    const built = spawnSync(process.execPath, ["build", "--compile", entry, ...senpiWorkerCompileArgs(root), "--outfile", binary], { cwd: root, encoding: "utf8", timeout: 30_000 })
    expect(built.status, built.stderr).toBe(0)
    console.log(JSON.stringify({ layout, bun: Bun.version, revision: Bun.revision, platform: process.platform, arch: process.arch, binarySha256: createHash("sha256").update(readFileSync(binary)).digest("hex") }))
    const relocated = join(scratch, "relocated")
    mkdirSync(relocated)
    const moved = join(relocated, process.platform === "win32" ? "omo.exe" : "omo")
    renameSync(binary, moved)
    rmSync(buildRoot, { recursive: true })
    const result = spawnSync(moved, [], { cwd: relocated, encoding: "utf8", timeout: 10_000 })
    // then
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout.trim()).toBe("two-workers-ready")
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}, 45_000)

test("#given a pre-worker engine #when resolving compile args #then the legacy graph stays unchanged", () => {
  const root = mkdtempSync(join(tmpdir(), "omo-worker-legacy-"))
  try {
    expect(senpiWorkerCompileArgs(root)).toEqual([])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
