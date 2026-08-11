import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const buildSource = readFileSync(new URL("./build.ts", import.meta.url), "utf8")

describe("build dependency graph", () => {
  test("#given Codex and Senpi share plugin dependencies #when scheduled #then Codex installation completes first", () => {
    const senpiNode = buildSource.match(/\{ id: "senpi-plugin".*deps: \[([^\]]*)\] \}/)

    expect(senpiNode?.[1]).toContain('"codex-plugin"')
  })
})
