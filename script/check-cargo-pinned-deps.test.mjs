import { describe, expect, test } from "bun:test"
import { unpinnedCargoDependencies } from "./check-cargo-pinned-deps.mjs"

describe("Cargo dependency pinning", () => {
  test("accepts exact pins and local workspace or path dependencies", () => {
    const manifest = [
      "[workspace.dependencies]",
      'png = "=0.18.1"',
      'zbus = { version = "=5.19.0", features = [',
      '  "blocking-api",',
      "] }",
      "[dependencies]",
      "serde = { workspace = true }",
      'core = { path = "../core" }',
      "[target.'cfg(target_os = \"linux\")'.dependencies]",
      'futures = "=0.3.32"',
      "[dev-dependencies]",
      "tempfile.workspace = true",
    ].join("\n")
    expect(unpinnedCargoDependencies(manifest, "Cargo.toml")).toEqual([])
  })

  test("rejects bare and range versions in string, table and dotted entries", () => {
    const manifest = [
      "[workspace.dependencies]",
      'zbus = { version = "5.19", default-features = false }',
      'png = "0.18.1"',
      'ashpd.version = "0.11"',
      "[package]",
      'version = "1.0.0"',
    ].join("\n")
    expect(unpinnedCargoDependencies(manifest, "Cargo.toml").map((problem) => problem.split(" ")[2])).toEqual([
      "zbus", "png", "ashpd",
    ])
  })
})
