import { mkdir, readdir, stat } from "node:fs/promises"
import { join, relative } from "node:path"
import targetFixture from "../../release-binary-pty-fixture.json"
import { hashFile, run, type Runtime } from "./runtime"

export async function captureBytes(runtime: Runtime) {
  return { pass: true, size: runtime.size, sha256: runtime.sha256, target: `${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`, bunVersion: Bun.version }
}
export async function captureSkills(runtime: Runtime) {
  const entries: { readonly path: string; readonly size: number; readonly sha256: string }[] = []
  for (const root of ["plugin/skills", "plugin/skills-conditional"]) {
    const directory = join(runtime.payload, root)
    for (const path of await readdir(directory, { recursive: true })) {
      const file = join(directory, path)
      const metadata = await stat(file)
      if (metadata.isFile()) entries.push({ path: relative(runtime.payload, file).replaceAll("\\", "/"), size: metadata.size, sha256: await hashFile(file) })
    }
  }
  entries.sort((left, right) => left.path.localeCompare(right.path, "en"))
  return { pass: entries.length > 0, entries }
}
export async function captureTargetBytes(runtime: Runtime) {
  const assets = join(runtime.root, "release-assets")
  await mkdir(assets)
  const rows = []
  for (const target of Object.keys(targetFixture.targets).sort()) {
    const binaryName = `omo-${target}${target.startsWith("windows-") ? ".exe" : ""}`
    // Release asset acquisition is the sole public-network exception; no credentials enter the audited process.
    const result = await run(["gh", "release", "download", "v5.0.0-beta.62", "--repo", "code-yeongyu/oh-my-openagent", "--pattern", binaryName, "--dir", assets],
      { cwd: runtime.cwd, env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" }, timeoutMs: 180000 })
    runtime.commands.push(result)
    if (result.exitCode !== 0) {
      rows.push({ target, status: "no-baseline", ceiling: 157286400, reason: result.stderr.trim(), exitCode: result.exitCode })
      continue
    }
    const file = join(assets, binaryName)
    rows.push({ target, status: "available", size: (await stat(file)).size, sha256: await hashFile(file), release: "v5.0.0-beta.62" })
  }
  return { pass: true, bestEffort: true, targets: rows }
}
