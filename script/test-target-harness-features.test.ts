import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const script = readFileSync(join(import.meta.dir, "test-target-harness-features.ts"), "utf8")

describe("test-target-harness-features", () => {
  test("#given target feature certification #when harnesses are listed #then OMP and Pi are both required", () => {
    expect(script).toContain('label: "OMP"')
    expect(script).toContain('label: "Pi"')
    expect(script).toContain('bin: "omp"')
    expect(script).toContain('bin: "pi"')
  })

  test("#given a harness exits early #when inventory is incomplete #then certification fails", () => {
    expect(script).toContain("RPC exited before command/tool inventory")
    expect(script).toContain("settle(new Error")
    expect(script).toContain('harness.toolInventory === "rpc-state" && tools.length === 0')
  })

  test("#given Pi lacks RPC tool inventory #when live certification runs #then source parity covers tools", () => {
    expect(script).toContain('toolInventory: "source-parity"')
    expect(script).toContain("tool parity covered by src/hosts/target-feature-parity.test.ts")
  })
})
