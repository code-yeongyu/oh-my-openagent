import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

export function diagnoseHeldTestRoot(root, { platform = process.platform, run = spawnSync } = {}) {
  if (platform !== "win32") return { holders: [], diagnosticErrors: [] }
  try {
    const powershell = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    const result = run(powershell, [
      "-NoProfile", "-NonInteractive", "-File",
      fileURLToPath(new URL("./windows-held-root.ps1", import.meta.url)), "-Root", root,
    ], { encoding: "utf8", windowsHide: true, timeout: 30_000 })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(`holder query exited ${result.status}: ${result.stderr}`)
    const record = JSON.parse(result.stdout.replace(/^\uFEFF/, "").trim())
    if (!Array.isArray(record.holders) || !record.holders.every((holder) =>
      Number.isInteger(holder.pid) && holder.pid > 0 && (typeof holder.image === "string" || holder.image === null)
      && (holder.parentPid === null || Number.isInteger(holder.parentPid)))
      || !Array.isArray(record.diagnosticErrors) || !record.diagnosticErrors.every((error) => typeof error === "string")) {
      throw new Error("invalid holder query result")
    }
    return { ...record, holders: record.holders.map((holder) => ({ ...holder, image: holder.image || "unknown" })) }
  } catch (error) {
    return { holders: [], diagnosticErrors: [String(error)] }
  }
}
