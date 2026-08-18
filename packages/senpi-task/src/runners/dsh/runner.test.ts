/// <reference types="bun-types" />

import { describe, expect, test, mock, afterAll } from "bun:test"

import type { DshAcpRunInput } from "./acp-client"
import type { DshHeadlessRunInput } from "./headless-runner"
import type { VerificationInput } from "./verify"
import type { DshAuth, ResolveDshAuthOptions } from "./auth"

const headlessMock = mock(async (_input: DshHeadlessRunInput) => ({ output: "headless done", exitCode: 0 }))
const acpMock = mock(async (_input: DshAcpRunInput) => ({ output: "acp done", stopReason: "end_turn" }))
const verifyMock = mock(async (_input: VerificationInput) => ({ verified: true, evidence: "3 pass" }))
const authMock = mock(
  async (_env: NodeJS.ProcessEnv, _options: ResolveDshAuthOptions): Promise<DshAuth> => ({
    apiKey: "sk-test",
    baseUrl: "https://opencode.ai/zen/go/v1",
    model: "deepseek-v4-flash",
  }),
)

mock.module("./acp-client", () => ({
  runDshAcpAgent: acpMock,
}))
mock.module("./headless-runner", () => ({
  runDshHeadless: headlessMock,
}))
mock.module("./verify", () => ({
  runVerificationGate: verifyMock,
}))
mock.module("./auth", () => ({
  resolveDshAuth: authMock,
}))

afterAll(() => {
  mock.restore()
})

const { DshRunner } = await import("./runner")

describe("DshRunner", () => {
  test("#given default headless options #when run #then spawns the headless profile and returns its output", async () => {
    // given
    headlessMock.mockClear()
    const runner = new DshRunner()

    // when
    const outcome = await runner.run({ prompt: "fix the widget" })

    // then
    expect(headlessMock).toHaveBeenCalledTimes(1)
    const call = headlessMock.mock.calls[0]?.[0]
    expect(call?.command).toBe("npx")
    expect(call?.args).toEqual(["-y", "@deepseek-ai/dsh"])
    expect(call?.cwd).toBe(process.cwd())
    expect(call?.prompt).toBe("fix the widget")
    expect(call?.timeoutMs).toBe(300000)
    expect(outcome).toEqual({
      output: "headless done",
      stopReason: "completed",
      exitCode: 0,
      verified: false,
    })
  })

  test("#given acp mode #when run #then appends the acp subcommand and returns the client stop reason", async () => {
    // given
    acpMock.mockClear()
    const runner = new DshRunner({ mode: "acp", permission: "reject" })

    // when
    const outcome = await runner.run({ prompt: "fix the widget" })

    // then
    expect(acpMock).toHaveBeenCalledTimes(1)
    const call = acpMock.mock.calls[0]?.[0]
    expect(call?.args).toEqual(["-y", "@deepseek-ai/dsh", "acp"])
    expect(call?.permission).toBe("reject")
    expect(outcome).toEqual({
      output: "acp done",
      stopReason: "end_turn",
      exitCode: null,
      verified: false,
    })
  })

  test("#given a verify gate that passes #when run #then returns the verified outcome with the original output", async () => {
    // given
    headlessMock.mockClear()
    verifyMock.mockClear()
    verifyMock.mockResolvedValueOnce({ verified: true, evidence: "3 pass" })
    const runner = new DshRunner()

    // when
    const outcome = await runner.run({ prompt: "task", verify: "bun test" })

    // then
    expect(verifyMock).toHaveBeenCalledTimes(1)
    const gateCall = verifyMock.mock.calls[0]?.[0]
    expect(gateCall?.command).toBe("bun test")
    expect(gateCall?.cwd).toBe(process.cwd())
    expect(outcome).toEqual({
      output: "headless done",
      stopReason: "completed",
      exitCode: 0,
      verified: true,
      verify: "bun test",
    })
  })

  test("#given a verify gate that fails #when run #then appends the VERIFICATION FAILED block with truncated evidence", async () => {
    // given
    verifyMock.mockClear()
    verifyMock.mockResolvedValueOnce({ verified: false, evidence: "x".repeat(2000) })
    const runner = new DshRunner()

    // when
    const outcome = await runner.run({ prompt: "task", verify: "bun test" })

    // then
    expect(outcome.verified).toBe(false)
    expect(outcome.verify).toBe("bun test")
    expect(outcome.evidence).toBe("x".repeat(1500))
    expect(outcome.output).toContain("--- VERIFICATION FAILED ---")
    expect(outcome.output).toContain("--- END VERIFICATION ---")
    expect(outcome.output).toContain("x".repeat(1500))
    expect(outcome.output).not.toContain("x".repeat(1501))
  })

  test("#given an explicit cwd request arg #when run #then the request cwd wins over the options cwd", async () => {
    // given
    headlessMock.mockClear()
    const runner = new DshRunner({ cwd: "/options/dir" })

    // when
    await runner.run({ prompt: "task", cwd: "/explicit/dir" })

    // then
    const call = headlessMock.mock.calls[0]?.[0]
    expect(call?.cwd).toBe("/explicit/dir")
  })

  test("#given an auth accessor #when run #then the child env is built from the resolved auth", async () => {
    // given
    headlessMock.mockClear()
    authMock.mockClear()
    const getApiKeyForProvider = async (provider: string) =>
      provider === "opencode-go" ? "sk-engine" : undefined
    const runner = new DshRunner({ getApiKeyForProvider })

    // when
    await runner.run({ prompt: "task" })

    // then
    expect(authMock).toHaveBeenCalledTimes(1)
    expect(authMock.mock.calls[0]?.[1].getApiKeyForProvider).toBe(getApiKeyForProvider)
    const call = headlessMock.mock.calls[0]?.[0]
    expect(call?.env).toEqual({
      DEEPSEEK_API_KEY: "sk-test",
      DEEPSEEK_BASE_URL: "https://opencode.ai/zen/go/v1",
      DSH_MODEL: "deepseek-v4-flash",
    })
  })

  test("#given an empty auth result #when run #then the child env carries no dsh variables", async () => {
    // given
    headlessMock.mockClear()
    authMock.mockClear()
    authMock.mockResolvedValueOnce({})
    const runner = new DshRunner()

    // when
    await runner.run({ prompt: "task" })

    // then
    const call = headlessMock.mock.calls[0]?.[0]
    expect(call?.env).toEqual({})
  })
})