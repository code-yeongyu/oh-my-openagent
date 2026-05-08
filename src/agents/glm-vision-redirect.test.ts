import { describe, test, expect } from "bun:test"
import { buildGlmVisionHardBlock, buildGlmSubagentVisionBlock } from "./sisyphus/glm"

describe("GLM Vision Redirect", () => {
  test("buildGlmVisionHardBlock contains zai-mcp-server tool mappings", () => {
    const block = buildGlmVisionHardBlock()
    expect(block).toContain("zai-mcp-server_analyze_image")
    expect(block).toContain("zai-mcp-server_extract_text_from_screenshot")
    expect(block).toContain("zai-mcp-server_diagnose_error_screenshot")
    expect(block).toContain("zai-mcp-server_understand_technical_diagram")
    expect(block).toContain("zai-mcp-server_analyze_data_visualization")
    expect(block).toContain("zai-mcp-server_ui_to_artifact")
    expect(block).toContain("zai-mcp-server_ui_diff_check")
    expect(block).toContain("zai-mcp-server_analyze_video")
  })

  test("buildGlmVisionHardBlock has fallback to multimodal-looker", () => {
    const block = buildGlmVisionHardBlock()
    expect(block).toContain("multimodal-looker")
  })

  test("buildGlmVisionHardBlock does NOT contain HARD BLOCK language", () => {
    const block = buildGlmVisionHardBlock()
    expect(block).not.toContain("NEVER call")
    expect(block).not.toContain("HARD BLOCK")
  })

  test("buildGlmSubagentVisionBlock contains zai-mcp-server tools", () => {
    const block = buildGlmSubagentVisionBlock()
    expect(block).toContain("zai-mcp-server")
    expect(block).toContain("multimodal-looker")
  })
})
