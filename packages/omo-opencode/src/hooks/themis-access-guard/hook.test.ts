import { describe, it, expect, mock, beforeEach } from "bun:test"
import { createThemisAccessGuardHook } from "./hook"

const mockGetSessionAgent = mock(() => "themis")
const mockLog = mock(() => {})

describe("createThemisAccessGuardHook", () => {
  describe("#given a themis session", () => {
    describe("#when writing to .sisyphus/deliberations/", () => {
      it("#then allows the write", async () => {
          const hook = createThemisAccessGuardHook({ getSessionAgent: mockGetSessionAgent, log: mockLog })
        const input = { tool: "write", sessionID: "ses_themis_123", callID: "c1" }
        const output = { args: { file_path: ".sisyphus/deliberations/test-001.md" } }
        await expect(hook["tool.execute.before"](input, output)).resolves.toBeUndefined()
      })
    })

    describe("#when writing outside .sisyphus/deliberations/", () => {
      it("#then throws access denied error", async () => {
          const hook = createThemisAccessGuardHook({ getSessionAgent: mockGetSessionAgent, log: mockLog })
        const input = { tool: "write", sessionID: "ses_themis_123", callID: "c2" }
        const output = { args: { file_path: "src/agents/other.ts" } }
        await expect(hook["tool.execute.before"](input, output)).rejects.toThrow("Themis access denied")
      })
    })
  })

  describe("#given a non-themis session", () => {
    beforeEach(() => {
      mockGetSessionAgent.mockReturnValue("hephaestus")
    })

    describe("#when writing anywhere", () => {
      it("#then passes through without restriction", async () => {
        const hook = createThemisAccessGuardHook({ getSessionAgent: mockGetSessionAgent, log: mockLog })
        const input = { tool: "write", sessionID: "ses_heph_123", callID: "c3" }
        const output = { args: { file_path: "src/agents/other.ts" } }
        await expect(hook["tool.execute.before"](input, output)).resolves.toBeUndefined()
      })
    })
  })
})
