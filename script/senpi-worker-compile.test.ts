import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { senpiWorkerCompileArgs } from "./senpi-worker-compile"

const variants = (["unsplit", "split"] as const).flatMap((mode) =>
  (["directory", "bun-link", "external-link"] as const).map((layout) => ({ mode, layout })),
)

test.each(variants)("#given $mode/$layout workers #when compiled and relocated #then two SAB round trips finish with worker exits", ({ mode, layout }) => {
  const scratch = mkdtempSync(join(tmpdir(), "omo-worker-compile-"))
  try {
    // given: mirror the published engine layout and compile-time worker contract.
    const buildRoot = join(scratch, "build")
    const root = join(buildRoot, "source")
    const packagePath = join(root, "node_modules/@code-yeongyu/senpi")
    const physicalPackage = {
      directory: packagePath,
      "bun-link": join(root, "node_modules/.bun/senpi/node_modules/@code-yeongyu/senpi"),
      "external-link": join(buildRoot, "engine"),
    }[layout]
    mkdirSync(join(physicalPackage, "dist/modes/rpc"), { recursive: true })
    if (physicalPackage !== packagePath) {
      mkdirSync(dirname(packagePath), { recursive: true })
      symlinkSync(physicalPackage, packagePath, "junction")
    }
    const worker = join(packagePath, "dist/modes/rpc/session-worker.js")
    writeFileSync(worker, `import { parentPort } from "node:worker_threads";
parentPort.once("message", (shared) => {
  const view = new Int32Array(shared);
  Atomics.add(view, 0, 7);
  parentPort.postMessage(Atomics.load(view, 0));
  parentPort.close();
});`)
    const entry = join(root, "entry.ts")
    writeFileSync(entry, `import assert from "node:assert/strict";
import { once } from "node:events";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
const path = typeof SENPI_RPC_SESSION_WORKER_ENTRY === "string" ? SENPI_RPC_SESSION_WORKER_ENTRY : "./src/modes/rpc/session-worker.ts";
const results = await Promise.all([11, 23].map(async (input) => {
  const shared = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  const view = new Int32Array(shared);
  Atomics.store(view, 0, input);
  const worker = new Worker(fileURLToPath(new URL(path, import.meta.url)).replaceAll("\\\\", "/"));
  const signal = AbortSignal.timeout(5000);
  const reply = once(worker, "message", { signal });
  const exited = once(worker, "exit", { signal });
  try {
    worker.postMessage(shared);
    const [[message], [exitCode]] = await Promise.all([reply, exited]);
    assert.equal(message, input + 7);
    assert.equal(Atomics.load(view, 0), input + 7);
    assert.equal(exitCode, 0);
    return { input, message, shared: Atomics.load(view, 0), exitCode };
  } finally {
    await worker.terminate();
  }
}));
console.log(JSON.stringify(results));`)
    const binary = join(scratch, process.platform === "win32" ? "omo.exe" : "omo")
    // when: use the release optimization flags in split mode, then remove all source.
    const flags = { unsplit: [], split: ["--splitting", "--minify", "--keep-names"] }[mode]
    const built = spawnSync(process.execPath, ["build", "--compile", ...flags, entry, ...senpiWorkerCompileArgs(root), "--outfile", binary], { cwd: root, encoding: "utf8", timeout: 30_000 })
    expect(built.status, built.stderr).toBe(0)
    console.log(JSON.stringify({ mode, layout, bun: Bun.version, revision: Bun.revision, platform: process.platform, arch: process.arch, binarySha256: createHash("sha256").update(readFileSync(binary)).digest("hex") }))
    const relocated = join(scratch, "relocated")
    mkdirSync(relocated)
    const moved = join(relocated, process.platform === "win32" ? "omo.exe" : "omo")
    renameSync(binary, moved)
    rmSync(buildRoot, { recursive: true })
    const result = spawnSync(moved, [], { cwd: relocated, encoding: "utf8", timeout: 10_000 })
    // then: assert machine-consumed values, including the shared memory and natural exit.
    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual([
      { input: 11, message: 18, shared: 18, exitCode: 0 },
      { input: 23, message: 30, shared: 30, exitCode: 0 },
    ])
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}, 45_000)

test("#given a pre-worker engine #when resolving compile args #then the legacy graph stays unchanged", () => {
  // given
  const root = mkdtempSync(join(tmpdir(), "omo-worker-legacy-"))
  try {
    // when / then
    expect(senpiWorkerCompileArgs(root)).toEqual([])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
