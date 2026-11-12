import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { withHostClaim } from "./host-claim"
import type { TaskRecord } from "./record-types"

const base = { task_id: "st_00000001", host_pid: 1, host_manager_instance: "old" } as unknown as TaskRecord

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === "__fixtures__" ? [] : sources(path)
    return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [path] : []
  })
}

// bun fmt wraps a long destructure, so the two bindings are not always one physical line.
function destructureAt(lines: readonly string[], index: number): string {
  let start = index
  while (start > 0 && !lines[start]?.includes("{")) start -= 1
  let end = index
  while (end < lines.length - 1 && !lines[end]?.includes("}")) end += 1
  return lines.slice(start, end + 1).join("\n")
}

describe("host_manager_instance travels with host_pid (design 3.5, test 23)", () => {
  test("#given a claim by another manager #when written #then the old instance is replaced, and an unknown one is dropped", () => {
    expect(withHostClaim(base, 2, "new")).toMatchObject({ host_pid: 2, host_manager_instance: "new" })
    expect("host_manager_instance" in withHostClaim(base, 2, undefined)).toBe(false)
  })

  // Storage contract: a cleared host_pid with a surviving manager instance would address an owner
  // that no longer holds the record, so every clear site drops both in the same destructure.
  test("#given every source site that drops host_pid #when read #then the same destructure drops host_manager_instance", () => {
    const sites = sources(join(import.meta.dirname, "..")).flatMap((path) => {
      const lines = readFileSync(path, "utf8").split("\n")
      return lines.flatMap((line, index) => (line.includes("host_pid: _") ? [{ path, index, lines }] : []))
    })
    expect(sites.length).toBeGreaterThanOrEqual(9)
    expect(
      sites
        .filter((site) => !destructureAt(site.lines, site.index).includes("host_manager_instance: _"))
        .map((site) => `${site.path}:${site.index + 1}`),
    ).toEqual([])
  })

  test("#given host_pid dropped in one statement and the instance only in the next #when the destructure is read #then that site does not count as cleared together", () => {
    const lines = ["const { host_pid: _hostPid, ...rest } = fresh", "const next = { host_manager_instance: _kept }"]
    expect(destructureAt(lines, 0).includes("host_manager_instance: _")).toBe(false)
  })
})
