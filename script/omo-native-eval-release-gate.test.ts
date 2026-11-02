import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const workflow = readFileSync(
  new URL("../.github/workflows/publish-platform.yml", import.meta.url),
  "utf8",
)

describe("standalone binary eval release gate", () => {
  test("#given the platform release workflow #when darwin-arm64 is freshly built #then the compiled binary runs the eval smoke before upload", () => {
    // given
    const buildIndex = workflow.indexOf("      - name: Build release binary\n")
    const evalIndex = workflow.indexOf("      - name: Smoke eval registration in fresh binary\n")
    const uploadIndex = workflow.indexOf("      - name: Upload release binary artifact\n")

    // when
    const evalStep = workflow.slice(evalIndex, uploadIndex)

    // then
    expect(buildIndex).toBeGreaterThan(-1)
    expect(evalIndex).toBeGreaterThan(buildIndex)
    expect(uploadIndex).toBeGreaterThan(evalIndex)
    expect(evalStep).toContain("matrix.platform == 'darwin-arm64'")
    expect(evalStep).toContain("bun script/qa/omo-native-eval-smoke.mjs")
    expect(evalStep).toContain(".omo/release-binaries/omo-darwin-arm64")
  })
})
