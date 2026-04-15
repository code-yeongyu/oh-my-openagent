import { describe, it, expect } from "bun:test"
import { playwrightSkill } from "./playwright"

describe("playwrightSkill", () => {
  describe("#given supply chain security requirements", () => {
    describe("#when checking mcpConfig.playwright.args", () => {
      it("#then should use fixed version instead of @latest", () => {
        // given: supply chain attack対策で@latestは禁止
        const args = playwrightSkill.mcpConfig?.playwright.args

        // when: argsを検証

        // then: 固定バージョンが使用されていること
        expect(args).toBeDefined()
        expect(args).toHaveLength(1)
        expect(args![0]).toMatch(/^@playwright\/mcp@\d+\.\d+\.\d+$/)
        expect(args![0]).not.toContain("@latest")
      })

      it("#then should use current stable version 0.0.70", () => {
        // given: 現時点の安定版バージョン

        // when: mcpConfigを取得
        const args = playwrightSkill.mcpConfig?.playwright.args

        // then: バージョン0.0.70が固定されている
        expect(args![0]).toBe("@playwright/mcp@0.0.70")
      })
    })
  })
})
