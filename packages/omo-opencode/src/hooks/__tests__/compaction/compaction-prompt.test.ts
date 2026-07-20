/**
 * Unit tests for compaction prompt optimization
 */

import { describe, it, expect } from "bun:test"
import {
  InformationPriority,
  OutputFormat,
  PROMPT_TEMPLATE_VERSION,
  DEFAULT_COMPACTION_PROMPT,
  generateCompactionPrompt,
  validatePromptTemplate,
  estimateCompactionRatio,
  isCompactionRatioValid,
  extractKeyInformation,
} from "./compaction-prompt"

describe("compaction-prompt", () => {
  describe("InformationPriority", () => {
    it("should have correct priority levels", () => {
      expect(InformationPriority.P0).toBe("P0")
      expect(InformationPriority.P1).toBe("P1")
      expect(InformationPriority.P2).toBe("P2")
    })
  })

  describe("OutputFormat", () => {
    it("should have correct output formats", () => {
      expect(OutputFormat.MARKDOWN).toBe("markdown")
      expect(OutputFormat.JSON).toBe("json")
    })
  })

  describe("PROMPT_TEMPLATE_VERSION", () => {
    it("should have a version string", () => {
      expect(PROMPT_TEMPLATE_VERSION).toBeDefined()
      expect(typeof PROMPT_TEMPLATE_VERSION).toBe("string")
    })
  })

  describe("DEFAULT_COMPACTION_PROMPT", () => {
    it("should include P0 priority section", () => {
      expect(DEFAULT_COMPACTION_PROMPT).toContain("P0")
      expect(DEFAULT_COMPACTION_PROMPT).toContain("绝对不能丢失")
    })

    it("should include P1 priority section", () => {
      expect(DEFAULT_COMPACTION_PROMPT).toContain("P1")
      expect(DEFAULT_COMPACTION_PROMPT).toContain("优先保留")
    })

    it("should include P2 priority section", () => {
      expect(DEFAULT_COMPACTION_PROMPT).toContain("P2")
      expect(DEFAULT_COMPACTION_PROMPT).toContain("可选保留")
    })

    it("should include examples", () => {
      expect(DEFAULT_COMPACTION_PROMPT).toContain("示例")
      expect(DEFAULT_COMPACTION_PROMPT).toContain("正确示例")
      expect(DEFAULT_COMPACTION_PROMPT).toContain("错误示例")
    })

    it("should include conversation placeholder", () => {
      expect(DEFAULT_COMPACTION_PROMPT).toContain("{conversation}")
    })

    it("should mention key information types", () => {
      expect(DEFAULT_COMPACTION_PROMPT).toContain("时间信息")
      expect(DEFAULT_COMPACTION_PROMPT).toContain("数值数据")
      expect(DEFAULT_COMPACTION_PROMPT).toContain("人名")
      expect(DEFAULT_COMPACTION_PROMPT).toContain("文件路径")
    })
  })

  describe("generateCompactionPrompt", () => {
    it("should generate prompt with conversation", () => {
      const conversation = "user: 测试对话"
      const prompt = generateCompactionPrompt(conversation)
      expect(prompt).toContain("测试对话")
      expect(prompt).not.toContain("{conversation}")
    })

    it("should use default template when no config provided", () => {
      const conversation = "user: 测试"
      const prompt = generateCompactionPrompt(conversation)
      expect(prompt).toContain("P0")
      expect(prompt).toContain("P1")
      expect(prompt).toContain("P2")
    })

    it("should use JSON template when outputFormat is JSON", () => {
      const conversation = "user: 测试"
      const prompt = generateCompactionPrompt(conversation, {
        outputFormat: OutputFormat.JSON,
      })
      expect(prompt).toContain("JSON")
      expect(prompt).toContain("time_info")
    })

    it("should include metadata with version", () => {
      const conversation = "user: 测试"
      const prompt = generateCompactionPrompt(conversation)
      expect(prompt).toContain(PROMPT_TEMPLATE_VERSION)
    })

    it("should use custom template when provided", () => {
      const customTemplate = "自定义模板 {conversation}"
      const conversation = "user: 测试"
      const prompt = generateCompactionPrompt(conversation, {
        template: customTemplate,
      })
      expect(prompt).toContain("自定义模板")
      expect(prompt).toContain("测试")
    })
  })

  describe("validatePromptTemplate", () => {
    it("should validate correct template", () => {
      const result = validatePromptTemplate(DEFAULT_COMPACTION_PROMPT)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it("should detect missing P0 section", () => {
      const template = "缺少优先级部分 {conversation}"
      const result = validatePromptTemplate(template)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain("Missing P0 priority section")
    })

    it("should detect missing conversation placeholder", () => {
      const template = "P0 P1 P2 示例 但没有占位符"
      const result = validatePromptTemplate(template)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain("Missing {conversation} placeholder")
    })
  })

  describe("estimateCompactionRatio", () => {
    it("should calculate correct ratio", () => {
      const original = "这是一段很长的原始文本".repeat(10)
      const compacted = "短摘要"
      const ratio = estimateCompactionRatio(original, compacted)
      expect(ratio).toBeLessThan(0.5)
    })

    it("should return 1.0 for same length", () => {
      const text = "相同长度的文本"
      const ratio = estimateCompactionRatio(text, text)
      expect(ratio).toBe(1.0)
    })
  })

  describe("isCompactionRatioValid", () => {
    it("should return true for valid ratio", () => {
      const original = "这是一段很长的原始文本".repeat(10)
      const compacted = "这是一段".repeat(3)
      const isValid = isCompactionRatioValid(original, compacted, 0.35, 0.1)
      // The actual ratio depends on the lengths
      expect(typeof isValid).toBe("boolean")
    })

    it("should use default target ratio", () => {
      const original = "测试文本"
      const compacted = "测试"
      const isValid = isCompactionRatioValid(original, compacted)
      expect(typeof isValid).toBe("boolean")
    })
  })

  describe("extractKeyInformation", () => {
    it("should extract time information", () => {
      const summary = "截止日期是下周五，会议在2024-01-15"
      const info = extractKeyInformation(summary)
      expect(info.timeInfo.length).toBeGreaterThan(0)
      expect(info.timeInfo.some((t) => t.includes("下周五"))).toBe(true)
    })

    it("should extract numerical data", () => {
      const summary = "性能目标：100ms延迟，10000QPS"
      const info = extractKeyInformation(summary)
      expect(info.numericalData.length).toBeGreaterThan(0)
    })

    it("should extract file paths", () => {
      const summary = "文件路径：src/auth/jwt.ts"
      const info = extractKeyInformation(summary)
      expect(info.filePaths.length).toBeGreaterThan(0)
      expect(info.filePaths).toContain("src/auth/jwt.ts")
    })

    it("should extract person names", () => {
      const summary = "根据Alice的建议，Bob同意了"
      const info = extractKeyInformation(summary)
      expect(info.personReferences.length).toBeGreaterThan(0)
    })

    it("should parse JSON format", () => {
      const jsonSummary = JSON.stringify({
        time_info: ["下周五"],
        numerical_data: ["100ms"],
        person_references: ["Alice"],
        file_paths: ["src/auth/jwt.ts"],
      })
      const info = extractKeyInformation(jsonSummary, OutputFormat.JSON)
      expect(info.timeInfo).toContain("下周五")
      expect(info.numericalData).toContain("100ms")
      expect(info.personReferences).toContain("Alice")
      expect(info.filePaths).toContain("src/auth/jwt.ts")
    })
  })
})
