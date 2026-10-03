import { expect, spyOn, test } from "bun:test"
import { spawn } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { computerUseDoctorReport } from "../../../../omo-native/computer-use-doctor-runtime"
import { describeEngineSource } from "./engine-source"

test.each(["explicit", "runtime-dir", "sidecar", "package-prebuild", "dev-build", "cache"])(
  "%s engine location and source agree with doctor without downloading",
  async (source) => {
    const root = mkdtempSync(join(tmpdir(), "cu-installed-source-"))
    const originalExec = process.execPath
    const execDir = join(root, "bin")
    const packageRoot = join(root, "packages", "omo-native")
    const packageDir = join(root, "packages", "senpi-desktop-engine")
    const runtimeDir = join(root, "runtime")
    const host = "linux-x64"
    const version = "5.1.7"
    const prebuild = join("native", "prebuilds", host, "senpi-desktop-engine")
    const body = `
import { createInterface } from "node:readline";
const capabilities = { backend: "fake", capture: true, input: false, ax: false,
 backgroundWindowInput: false, deliveryModes: [], capturePermission: "granted",
 inputPermission: "denied", axPermission: "denied", displayCount: 1,
 focusGuard: true, stopPath: "none", screenLocked: false };
createInterface({ input: process.stdin }).on("line", line => {
 const req = JSON.parse(line);
 const result = req.method === "engine.hello"
  ? { protocolVersion: "1", engineVersion: "test", buildSha: "test", abi: "senpi-desktop/1" }
  : req.method === "capabilities" ? capabilities : undefined;
 process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: req.id,
  ...(result === undefined ? { error: { code: -32601, message: "forbidden method" } } : { result }) }) + "\\n");
});
`
    const digest = createHash("sha256").update(body).digest("hex")
    const paths: Record<string, string> = {
      explicit: join(root, "explicit-engine.mjs"),
      "runtime-dir": join(runtimeDir, prebuild),
      sidecar: join(execDir, prebuild),
      "package-prebuild": join(packageDir, prebuild),
      "dev-build": join(root, "target", "release", "senpi-desktop-engine"),
      cache: join(root, ".omo", "cache", "senpi-desktop-engine", version, host,
        `${digest}-${randomUUID()}`, "senpi-desktop-engine-linux-x64"),
    }
    const engine = paths[source]
    mkdirSync(dirname(engine), { recursive: true })
    writeFileSync(engine, body)
    chmodSync(engine, 0o755)
    mkdirSync(runtimeDir, { recursive: true })
    writeFileSync(join(runtimeDir, "package.json"), JSON.stringify({ name: "omo", version }))
    mkdirSync(join(root, ".omo"), { recursive: true })
    writeFileSync(join(root, ".omo", "omo.jsonc"), JSON.stringify({
      "[native]": { computer: { enabled: true, ...(source === "explicit" ? { engine_path: engine } : {}) } },
    }))
    const env = { HOME: root, OMO_PACKAGE_DIR: runtimeDir }
    const fetch = spyOn(globalThis, "fetch").mockImplementation(Object.assign(
      () => { throw new Error("must not download") }, { preconnect: globalThis.fetch.preconnect },
    ))
    try {
      // The executable's directory is a production source input. Keep this case's candidates isolated.
      process.execPath = join(execDir, "runtime")
      const report = await computerUseDoctorReport({
        cwd: root, env, version, packageRoot, platform: "linux", arch: "x64",
        launchEngine: (path, args, childEnv) => spawn(originalExec, [path, ...args], {
          stdio: "pipe", detached: true, env: childEnv,
        }),
      })
      expect(report.kind).toBe("ready")
      if (report.kind !== "ready") throw new Error("expected installed engine")
      expect(report.enginePath).toBe(engine)
      expect(report.engineSource).toBe(source)
      expect(describeEngineSource(source === "explicit" ? engine : undefined, env, {
        platform: "linux", arch: "x64", execDir, packageDir, repoRoot: root,
      })).toBe(`found ${report.enginePath} (${source}${source === "cache" ? `, omo v${version}` : ""})`)
      expect(fetch).not.toHaveBeenCalled()
      expect(readFileSync(engine, "utf8")).toBe(body)
    } finally {
      process.execPath = originalExec
      fetch.mockRestore()
      rmSync(root, { recursive: true, force: true })
    }
  },
)
