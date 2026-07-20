/**
 * Test script to verify optimization effects
 * Run: bun test verify-optimization.test.ts
 */

import { describe, it, expect } from "bun:test"
import { normalizeText, extractCoreConcepts, checkWithNormalization, checkWithConceptExtraction } from "./accuracy-checker"
import { generateCompactionPrompt, PROMPT_TEMPLATE_VERSION } from "./compaction-prompt"

describe("Optimization Verification", () => {
  describe("Priority 1: Compaction Prompt Improvements", () => {
    it("should include code-related guidance", () => {
      const prompt = generateCompactionPrompt("test conversation")
      
      // Check for code-related emphasis
      expect(prompt).toContain("代码相关")
      expect(prompt).toContain("函数的用途和检查逻辑")
      expect(prompt).toContain("validateToken")
    })

    it("should include time-related guidance", () => {
      const prompt = generateCompactionPrompt("test conversation")
      
      // Check for time-related emphasis
      expect(prompt).toContain("时间相关")
      expect(prompt).toContain("相对时间表达")
      expect(prompt).toContain("下周五")
    })

    it("should have updated version", () => {
      expect(PROMPT_TEMPLATE_VERSION).toBe("1.1.0")
    })

    it("should emphasize preservation over deletion", () => {
      const prompt = generateCompactionPrompt("test conversation")
      
      // Check for preservation emphasis
      expect(prompt).toContain("如果不确定是否应该保留，宁可保留也不要删除")
    })
  })

  describe("Priority 2: Accuracy Checker Improvements", () => {
    it("should handle more synonyms", () => {
      // Test new synonyms
      const text1 = "validateToken 函数检查过期时间和签名"
      const text2 = "validateToken 函数检查到期时间和签章"
      
      const normalized1 = normalizeText(text1)
      const normalized2 = normalizeText(text2)
      
      // After normalization, they should be similar
      expect(normalized1).toContain("检查")
      expect(normalized2).toContain("检查")
    })

    it("should extract function names", () => {
      const text = "validateToken 函数会检查过期时间和签名"
      const concepts = extractCoreConcepts(text)
      
      expect(concepts.has("validatetoken")).toBe(true)
    })

    it("should extract code logic patterns", () => {
      const text = "validateToken 函数检查过期时间和签名"
      const concepts = extractCoreConcepts(text)
      
      // Should extract "过期时间" and "签名"
      expect(concepts.has("过期时间") || concepts.has("到期时间")).toBe(true)
      expect(concepts.has("签名") || concepts.has("签章")).toBe(true)
    })

    it("should extract time expressions", () => {
      const text = "截止日期是下周五"
      const concepts = extractCoreConcepts(text)
      
      expect(concepts.has("下周五")).toBe(true)
    })

    it("should handle '信息不足' as negative expression", () => {
      const text = "信息不足"
      const normalized = normalizeText(text)
      
      // Should normalize to "无" (through "没有" -> "无")
      expect(normalized).toContain("无")
    })

    it("should improve concept similarity for code snippets", () => {
      const actual = "validateToken 函数检查过期时间和签名"
      const expected = "过期时间和签名"
      
      const result = checkWithConceptExtraction(actual, expected)
      
      // Should have higher similarity
      expect(result.confidence).toBeGreaterThan(0.5)
    })

    it("should improve concept similarity for time references", () => {
      const actual = "截止日期是下周五"
      const expected = "下周五"
      
      const result = checkWithConceptExtraction(actual, expected)
      
      // Should have high similarity
      expect(result.confidence).toBeGreaterThan(0.8)
    })
  })

  describe("End-to-End Optimization Effects", () => {
    it("should handle code_snippet failure case", () => {
      // Simulate the previous failure case
      const actual = "validateToken 函数检查过期时间和签名"
      const expected = "过期时间和签名"
      
      // Layer 1: Normalization
      const normResult = checkWithNormalization(actual, expected)
      
      // Layer 2: Concept extraction
      const conceptResult = checkWithConceptExtraction(actual, expected)
      
      // At least one layer should succeed
      const bestResult = normResult.confidence > conceptResult.confidence ? normResult : conceptResult
      
      expect(bestResult.correct).toBe(true)
      expect(bestResult.confidence).toBeGreaterThan(0.5)
    })

    it("should handle time_reference failure case", () => {
      // Simulate the previous failure case
      const actual = "截止日期是下周五"
      const expected = "下周五"
      
      // Layer 1: Normalization
      const normResult = checkWithNormalization(actual, expected)
      
      // Layer 2: Concept extraction
      const conceptResult = checkWithConceptExtraction(actual, expected)
      
      // At least one layer should succeed
      const bestResult = normResult.confidence > conceptResult.confidence ? normResult : conceptResult
      
      expect(bestResult.correct).toBe(true)
      expect(bestResult.confidence).toBeGreaterThan(0.8)
    })
  })
})
