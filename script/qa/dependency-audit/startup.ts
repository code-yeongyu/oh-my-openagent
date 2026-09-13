import { join } from "node:path"
import { mkdir } from "node:fs/promises"
import { z } from "zod"
import { AuditError, parseTimings } from "./contracts"
import { modelServer } from "./model-server"
import { execute, requireSuccess, writeModels, type Runtime } from "./runtime"

export async function captureStartup(runtime: Runtime) {
  const mock = modelServer("audit-ok")
  try {
    await writeModels(runtime, { "audit-local": { api: "openai-completions", baseUrl: mock.baseUrl } })
    const args = ["--no-skills", "--no-context-files", "--no-session", "--provider", "audit-local", "--model", "audit-v1", "-p", "audit-ok"]
    const control = requireSuccess(await execute(runtime, [runtime.binary, ...args]))
    if (control.stdout.trim().split("\n").at(-1) !== "audit-ok") throw new AuditError("startup", `one-shot sentinel mismatch: ${control.stdout}`)
    const artifactDir = join(runtime.out, "startup-artifacts")
    await mkdir(artifactDir, { recursive: true })
    const versionFile = join(artifactDir, "version.hyperfine.json")
    const oneshotFile = join(artifactDir, "oneshot.hyperfine.json")
    for (const [file, command] of [[versionFile, `"${runtime.binary}" --version`], [oneshotFile, `"${runtime.binary}" ${args.join(" ")}`]]) {
      if (!file || !command) throw new AuditError("startup", "missing benchmark command")
      requireSuccess(await execute(runtime, ["hyperfine", "--warmup", "3", "--runs", "30", "--shell=none", "--export-json", file, command], 300000))
    }
    const read = async (file: string) => {
      const raw = z.object({ results: z.array(z.unknown()).length(1) }).parse(await Bun.file(file).json())
      return parseTimings(raw.results[0])
    }
    return { pass: true, version: await read(versionFile), oneshot: await read(oneshotFile), requests: mock.requests.length, sentinel: "audit-ok", serverClosed: true }
  } finally { await mock.server.stop(true) }
}
