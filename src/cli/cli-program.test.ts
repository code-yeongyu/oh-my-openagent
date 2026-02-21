import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"

describe("cli-program install command flags", () => {
  const originalArgv = [...process.argv]

  afterEach(() => {
    process.argv = [...originalArgv]
    mock.restore()
  })

  async function runInstallCommandAndCaptureArgs(argv: string[]): Promise<Record<string, unknown>> {
    const installMock = mock(async () => 0)
    mock.module("./install", () => ({ install: installMock }))

    const exitCodes: number[] = []
    const exitSpy = spyOn(process, "exit").mockImplementation(((code?: number) => {
      exitCodes.push(code ?? 0)
      return undefined as never
    }) as never)

    process.argv = ["bun", "oh-my-opencode", ...argv]

    const { runCli } = await import(`./cli-program?test=${Date.now()}-${Math.random()}`)

    runCli()
    await new Promise((resolve) => setTimeout(resolve, 0))

    exitSpy.mockRestore()
    expect(exitCodes).toEqual([0])
    expect(installMock).toHaveBeenCalledTimes(1)
    return installMock.mock.calls[0][0] as Record<string, unknown>
  }

  it("parses --lmstudio URL value", async () => {
    //#given / #when
    const parsedArgs = await runInstallCommandAndCaptureArgs([
      "install",
      "--no-tui",
      "--claude=yes",
      "--openai=no",
      "--gemini=no",
      "--copilot=no",
      "--opencode-zen=no",
      "--zai-coding-plan=no",
      "--kimi-for-coding=no",
      "--lmstudio=http://localhost:1234/v1",
    ])

    //#then
    expect(parsedArgs.lmstudio).toBe("http://localhost:1234/v1")
  })

  it("parses --ollama URL value", async () => {
    //#given / #when
    const parsedArgs = await runInstallCommandAndCaptureArgs([
      "install",
      "--no-tui",
      "--claude=yes",
      "--openai=no",
      "--gemini=no",
      "--copilot=no",
      "--opencode-zen=no",
      "--zai-coding-plan=no",
      "--kimi-for-coding=no",
      "--ollama=http://localhost:11434",
    ])

    //#then
    expect(parsedArgs.ollama).toBe("http://localhost:11434")
  })

  it("parses --vllm URL value", async () => {
    //#given / #when
    const parsedArgs = await runInstallCommandAndCaptureArgs([
      "install",
      "--no-tui",
      "--claude=yes",
      "--openai=no",
      "--gemini=no",
      "--copilot=no",
      "--opencode-zen=no",
      "--zai-coding-plan=no",
      "--kimi-for-coding=no",
      "--vllm=http://localhost:8000/v1",
    ])

    //#then
    expect(parsedArgs.vllm).toBe("http://localhost:8000/v1")
  })

  it("keeps local provider args undefined when local flags are omitted", async () => {
    //#given / #when
    const parsedArgs = await runInstallCommandAndCaptureArgs([
      "install",
      "--no-tui",
      "--claude=yes",
      "--openai=no",
      "--gemini=no",
      "--copilot=no",
      "--opencode-zen=no",
      "--zai-coding-plan=no",
      "--kimi-for-coding=no",
    ])

    //#then
    expect(parsedArgs.lmstudio).toBeUndefined()
    expect(parsedArgs.ollama).toBeUndefined()
    expect(parsedArgs.vllm).toBeUndefined()
  })
})
