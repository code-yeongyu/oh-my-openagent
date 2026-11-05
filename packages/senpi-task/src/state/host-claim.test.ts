import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { withHostClaim } from "./host-claim"
import type { TaskRecord } from "./record-types"

const base = { task_id: "st_00000001", host_pid: 1, host_manager_instance: "old" } as unknown as TaskRecord

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === "__fixtures__" ? [] : sources(path)
    return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [path] : []
  })
}

describe("host_manager_instance travels with host_pid (design 3.5, test 23)", () => {
  test("#given a claim by another manager #when written #then the old instance is replaced, and an unknown one is dropped", () => {
    expect(withHostClaim(base, 2, "new")).toMatchObject({ host_pid: 2, host_manager_instance: "new" })
    expect("host_manager_instance" in withHostClaim(base, 2, undefined)).toBe(false)
  })

  // Storage contract: a cleared host_pid with a surviving manager instance would address an owner
  // that no longer holds the record, so every clear site drops both in the same destructure.
  test("#given every source site that drops host_pid #when read #then the same destructure drops host_manager_instance", () => {
    const sites = sources(join(import.meta.dirname, "..")).flatMap(path =>
      readFileSync(path, "utf8").split("\n").flatMap((line, index) => line.includes("host_pid: _") ? [{ path, index, line }] : []))
    expect(sites.length).toBeGreaterThanOrEqual(9)
    expect(sites.filter(site => !site.line.includes("host_manager_instance: _")).map(site => `${site.path}:${site.index + 1}`)).toEqual([])
  })
})
