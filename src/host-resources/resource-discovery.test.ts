import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  discoverTargetResourcePaths,
  registerTargetResourceDiscovery,
  type TargetResourcesDiscoverEvent,
  type TargetResourcesDiscoverResult,
} from "./resource-discovery"

let root: string
let cwd: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "omo-target-resources-"))
  cwd = join(root, "project")
  mkdirSync(join(root, ".agents", "skills"), { recursive: true })
  mkdirSync(join(root, ".opencode", "skills"), { recursive: true })
  mkdirSync(join(root, "packages", "shared-skills", "skills"), { recursive: true })
  mkdirSync(join(cwd, ".agents", "skills"), { recursive: true })
  mkdirSync(join(cwd, ".opencode", "skills"), { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe("target resource discovery", () => {
  test("#given canonical legacy and shared skills #when discovered #then canonical paths precede compatibility paths", () => {
    const result = discoverTargetResourcePaths(root, cwd)
    expect(result.skillPaths?.map((path) => path.replace(root, ""))).toEqual([
      "/project/.agents/skills",
      "/project/.opencode/skills",
      "/.agents/skills",
      "/.opencode/skills",
      "/packages/shared-skills/skills",
    ])
  })

  test("#given target event API #when registered #then resources discover returns inventory", async () => {
    let handler:
      | ((event: TargetResourcesDiscoverEvent, context: unknown) => TargetResourcesDiscoverResult | Promise<TargetResourcesDiscoverResult>)
      | undefined
    registerTargetResourceDiscovery(
      {
        on: (_event, candidate) => {
          handler = candidate
        },
      },
      root,
    )
    const result = await handler?.({ type: "resources_discover", cwd, reason: "startup" }, {})
    expect(result?.skillPaths).toContain(join(cwd, ".agents", "skills"))
  })
})
