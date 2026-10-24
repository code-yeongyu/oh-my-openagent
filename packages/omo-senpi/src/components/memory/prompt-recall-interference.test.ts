import { expect, test } from "bun:test"
import { selectRecallCandidates, type RecallDocument } from "@oh-my-opencode/memory-core"
import { MemoryFakeExtensionAPI, memorySettings } from "./memory.test-support"
import { createMemoryNudgeWiring } from "./nudge-wiring"
import { createMemoryPromptHandler } from "./prompt"
import { beforeAgentStart, fixture, liveBranch } from "./prompt.test-support"
import { createMemoryNoticeInputs } from "./wiring-notice-inputs"

test("#given a warmed projection and cold recall #when recall is ready on the next event-loop turn #then projection finishes before tokenization", async () => {
  // given: the real handler, committed memory, notice watermarks, and a cold 6,862-note index.
  const { repo, context } = await fixture()
  const inputs = createMemoryNoticeInputs({
    resolveContext: () => context,
    loadSettings: () => memorySettings(),
  })
  const pi = new MemoryFakeExtensionAPI()
  const nudge = createMemoryNudgeWiring({
    resolveContext: () => context,
    resolveSettings: () => ({ enabled: true, everyUserTurns: 5 }),
  })
  nudge.register(pi)
  const branch = liveBranch(2)
  const event = { sessionManager: {
    getSessionId: () => "session-1", getBranch: () => branch, getEntries: () => branch,
  } }
  await pi.dispatch("session_start", { type: "session_start" }, event)
  const handler = createMemoryPromptHandler({
    resolveContext: () => context,
    createRepo: () => repo,
    resolveCompileWarnTokens: () => 30_000,
    resolveNudgeTurns: nudge.nudgeTurns,
    ...inputs,
  })
  const payload = beforeAgentStart("BASE PROMPT")
  const warm = await handler(payload, event)
  const documents: RecallDocument[] = Array.from({ length: 6_862 }, (_, index) => ({
    path: `reference/note-${index}.md`,
    description: `Synthetic deployment note ${index}`,
    body: "Deployment rollback checklist. 데이터베이스 배포 東京 記憶管理. ".repeat(48),
  }))
  const order: string[] = []
  const build = Promise.withResolvers<void>()
  // Register the next-turn work before triggering the prompt. This is a scheduler boundary,
  // not a delay: the assertion depends on order, never on elapsed milliseconds.
  setImmediate(() => {
    try {
      selectRecallCandidates(documents, ["deployment rollback"], { maxItems: 3, surfaced: new Set() })
      order.push("recall")
      build.resolve()
    } catch (error) {
      build.reject(error)
    }
  })

  // when: a warm prompt arrives before the ready detached build gets its event-loop turn.
  const projection = handler(payload, event).then((result) => {
    order.push("projection")
    return result
  })
  const [result] = await Promise.all([projection, build.promise])

  // then: the cold tokenizer cannot run between this warm prompt's awaits.
  expect(result).toEqual(warm)
  expect(order).toEqual(["projection", "recall"])
}, 30_000)
