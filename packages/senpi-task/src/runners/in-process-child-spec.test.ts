import { afterEach, describe, expect, test } from "bun:test"
import { rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { InProcessRunner, RunnerError } from "./in-process"
import { baseSpec, createFakeSession, makeTool, tmpSessionDirs } from "./in-process-child-spec.test-support"
import type { CreateAgentSessionOptions } from "./in-process-child-spec.test-support"
import type { ChildSession } from "./in-process"

const unhandled: unknown[] = []
const onUnhandled = (reason: unknown): void => { unhandled.push(reason) }
afterEach(() => { unhandled.length = 0; while (tmpSessionDirs.length > 0) rmSync(tmpSessionDirs.pop() ?? "", { recursive: true, force: true }) })

  test("#given handle construction touches a broken subscription #when start is called #then the created session is disposed before start rejects", async () => {
    const fake = createFakeSession()
    const broken: ChildSession = {
      ...fake.session,
      subscribe: () => { throw new Error("subscribe failed") },
    }
    const runner = new InProcessRunner({ createSession: async () => broken })

    await expect(runner.start(baseSpec())).rejects.toThrow("subscribe failed")
    expect(fake.disposeCount).toBe(1)
  })



describe("InProcessRunner completion policy", () => {
  test('#given a spec with completion "turn" #when the child settles with no assistant output #then start passes the policy through and the handle completes', async () => {
    const fake = createFakeSession()
    const runner = new InProcessRunner({ createSession: async () => fake.session })
    const handle = await runner.start(baseSpec({ completion: "turn" }))

    fake.resolvePrompt()

    expect(await handle.waitForIdle()).toEqual({ status: "completed", finalResponse: "" })
  })

  test('#given a spec with completion "turn" #when the child settles with no assistant output #then resume passes the policy through and the handle completes', async () => {
    const fake = createFakeSession()
    const runner = new InProcessRunner({ createSession: async () => fake.session })
    const spec = baseSpec({ completion: "turn" })
    const sessionPath = join(spec.sessionDir, "child.jsonl")
    writeFileSync(sessionPath, JSON.stringify({ type: "session", version: 3, id: fake.session.sessionId, cwd: spec.cwd }) + "\n")

    const handle = await runner.resume(spec, sessionPath)

    expect(await handle.waitForIdle()).toEqual({ status: "completed", finalResponse: "" })
    expect(fake.promptCalls).toBe(0)
  })
})

describe("InProcessRunner thinking level", () => {
  test("#given a spec carrying a thinking level #when the child session is created #then the level reaches the senpi session options", async () => {
    // given
    let captured: CreateAgentSessionOptions | undefined
    const fake = createFakeSession()
    const runner = new InProcessRunner({
      createSession: async (options) => {
        captured = options
        return fake.session
      },
    })

    // when
    const handle = await runner.start(baseSpec({ thinkingLevel: "xhigh" }))
    fake.resolvePrompt()
    await handle.waitForIdle()

    // then
    expect(captured?.thinkingLevel).toBe("xhigh")
  })

  test("#given a spec without a thinking level #when the child session is created #then no level is forced so senpi keeps its default", async () => {
    // given
    let captured: CreateAgentSessionOptions | undefined
    const fake = createFakeSession()
    const runner = new InProcessRunner({
      createSession: async (options) => {
        captured = options
        return fake.session
      },
    })

    // when
    const handle = await runner.start(baseSpec())
    fake.resolvePrompt()
    await handle.waitForIdle()

    // then
    expect(captured?.thinkingLevel).toBeUndefined()
  })
})

describe("InProcessRunner child system prompt", () => {
  test("#given a spec carrying a system prompt #when the child session is created #then the minimal loader returns it in place of the default", async () => {
    // given
    let captured: CreateAgentSessionOptions | undefined
    const fake = createFakeSession()
    const runner = new InProcessRunner({
      createSession: async (options) => {
        captured = options
        return fake.session
      },
    })

    // when
    const handle = await runner.start(baseSpec({ systemPrompt: "# Memorian\n\nYou judge turns." }))
    fake.resolvePrompt()
    await handle.waitForIdle()

    // then
    expect(captured?.resourceLoader?.getSystemPrompt()).toBe("# Memorian\n\nYou judge turns.")
  })

  test("#given a spec without a system prompt #when the child session is created #then the minimal loader keeps returning none", async () => {
    // given
    let captured: CreateAgentSessionOptions | undefined
    const fake = createFakeSession()
    const runner = new InProcessRunner({
      createSession: async (options) => {
        captured = options
        return fake.session
      },
    })

    // when
    const handle = await runner.start(baseSpec())
    fake.resolvePrompt()
    await handle.waitForIdle()

    // then
    expect(captured?.resourceLoader?.getSystemPrompt()).toBeUndefined()
  })
})

describe("InProcessRunner prompt envelope", () => {
  test("#given a bare envelope #when the child starts #then the spec prompt is delivered verbatim with no ancestry wrapper", async () => {
    // given
    const fake = createFakeSession()
    const runner = new InProcessRunner({ createSession: async () => fake.session })
    const prompt = "<memorian-input>\ncandidates and transcript only\n</memorian-input>"

    // when
    const handle = await runner.start(baseSpec({ prompt, promptEnvelope: "bare" }))
    fake.resolvePrompt()
    await handle.waitForIdle()

    // then
    expect(fake.promptTexts).toEqual([prompt])
  })

  test("#given no envelope #when the child starts #then the subagent ancestry lines wrap the prompt", async () => {
    // given
    const fake = createFakeSession()
    const runner = new InProcessRunner({ createSession: async () => fake.session })

    // when
    const handle = await runner.start(baseSpec({ prompt: "do the work" }))
    fake.resolvePrompt()
    await handle.waitForIdle()

    // then
    expect(fake.promptTexts).toHaveLength(1)
    const prompt = fake.promptTexts[0] ?? ""
    expect(prompt).toContain("You are running as an omo senpi-task child")
    expect(prompt).toContain("Task id: task-1")
    expect(prompt).toContain("Task:\ndo the work")
  })

  test("#given an explicit subagent envelope #when the child starts #then the ancestry wrapper applies exactly like the default", async () => {
    // given
    const fake = createFakeSession()
    const runner = new InProcessRunner({ createSession: async () => fake.session })

    // when
    const handle = await runner.start(baseSpec({ prompt: "do the work", promptEnvelope: "subagent" }))
    fake.resolvePrompt()
    await handle.waitForIdle()

    // then
    const prompt = fake.promptTexts[0] ?? ""
    expect(prompt).toContain("You are running as an omo senpi-task child")
    expect(prompt).toContain("Task:\ndo the work")
  })
})
