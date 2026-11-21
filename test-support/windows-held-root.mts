import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { SkippedTestRoot } from "./held-test-root.mjs"

type Diagnostic = Pick<SkippedTestRoot, "holders" | "diagnosticErrors">

function parseHolder(holder: unknown): Diagnostic["holders"][number] {
  if (
    typeof holder !== "object" ||
    holder === null ||
    !("pid" in holder) ||
    typeof holder.pid !== "number" ||
    !Number.isInteger(holder.pid) ||
    holder.pid <= 0 ||
    !("image" in holder) ||
    (typeof holder.image !== "string" && holder.image !== null) ||
    !("startTime" in holder) ||
    (typeof holder.startTime !== "string" && holder.startTime !== null) ||
    !("parentPid" in holder) ||
    (holder.parentPid !== null && (typeof holder.parentPid !== "number" || !Number.isInteger(holder.parentPid)))
  ) {
    throw new Error("invalid holder query result")
  }
  return {
    pid: holder.pid,
    image: holder.image || "unknown",
    startTime: holder.startTime,
    parentPid: holder.parentPid,
  }
}

export function diagnoseHeldTestRoot(root: string, { platform = process.platform, run = spawnSync } = {}): Diagnostic {
  if (platform !== "win32") return { holders: [], diagnosticErrors: [] }
  try {
    const powershell = join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    )
    const result = run(
      powershell,
      [
        "-NoProfile",
        "-NonInteractive",
        "-File",
        fileURLToPath(new URL("./windows-held-root.ps1", import.meta.url)),
        "-Root",
        root,
      ],
      { encoding: "utf8", windowsHide: true, timeout: 30_000 },
    )
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(`holder query exited ${result.status}: ${result.stderr}`)
    const record: unknown = JSON.parse(result.stdout.replace(/^\uFEFF/, "").trim())
    if (
      typeof record !== "object" ||
      record === null ||
      !("holders" in record) ||
      !Array.isArray(record.holders) ||
      !("diagnosticErrors" in record) ||
      !Array.isArray(record.diagnosticErrors) ||
      !record.diagnosticErrors.every((error: unknown) => typeof error === "string")
    ) {
      throw new Error("invalid holder query result")
    }
    return { holders: record.holders.map(parseHolder), diagnosticErrors: record.diagnosticErrors }
  } catch (error) {
    return { holders: [], diagnosticErrors: [String(error)] }
  }
}
