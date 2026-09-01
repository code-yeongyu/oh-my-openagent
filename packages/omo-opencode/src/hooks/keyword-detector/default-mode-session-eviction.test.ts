import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { _resetForTesting } from "../../features/claude-code-session-state"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { createKeywordDetectorHook } from "./hook"

type KeywordHook = ReturnType<typeof createKeywordDetectorHook> & {
  event?: (input: { event: { type: string; properties?: unknown } }) => void | Promise<void>
  dispose?: () => void
}

const DEFAULT_MODE = { ultrawork: true, goal: false }
const SESSION_CAP = 256

function createHook(toastMessages: string[]): KeywordHook {
  return createKeywordDetectorHook(
    unsafeTestValue({
      client: {
        tui: {
          showToast: async (opts: { body: { message: string } }) => {
            toastMessages.push(opts.body.message)
          },
        },
      },
    }),
    undefined,
    undefined,
    undefined,
    DEFAULT_MODE,
  ) as KeywordHook
}

async function sendPlainPrompt(hook: KeywordHook, sessionID: string): Promise<void> {
  await hook["chat.message"](
    { sessionID, agent: "sisyphus" },
    {
      message: {},
      parts: [{ type: "text", text: "please help with this task" }],
    },
  )
}

describe("keyword-detector defaultModeUltraworkInjectedSessions eviction", () => {
  let hook: KeywordHook | undefined

  beforeEach(() => {
    _resetForTesting()
  })

  afterEach(() => {
    hook?.dispose?.()
    hook = undefined
    _resetForTesting()
  })

  test("#given default ultrawork already injected #when session.deleted arrives #then the next prompt can inject again", async () => {
    //#given
    const toastMessages: string[] = []
    hook = createHook(toastMessages)
    const sessionID = "ses_default_ulw_deleted"

    await sendPlainPrompt(hook!, sessionID)
    expect(toastMessages).toHaveLength(1)
    toastMessages.length = 0
    await sendPlainPrompt(hook!, sessionID)
    expect(toastMessages).toHaveLength(0)

    //#when
    await hook!.event?.({
      event: { type: "session.deleted", properties: { sessionID } },
    })
    await sendPlainPrompt(hook!, sessionID)

    //#then
    expect(toastMessages).toHaveLength(1)
  })

  test("#given default ultrawork already injected #when dispose runs #then later sessions are not pinned by the old set", async () => {
    //#given
    const toastMessages: string[] = []
    hook = createHook(toastMessages)
    const sessionID = "ses_default_ulw_dispose"

    await sendPlainPrompt(hook!, sessionID)
    expect(toastMessages).toHaveLength(1)
    toastMessages.length = 0

    //#when
    hook!.dispose?.()
    await sendPlainPrompt(hook!, sessionID)

    //#then
    expect(toastMessages).toHaveLength(1)
  })

  test("#given more injected sessions than the cap #when another session is injected #then the oldest session can inject again", async () => {
    //#given
    const toastMessages: string[] = []
    hook = createHook(toastMessages)

    for (let index = 0; index <= SESSION_CAP; index += 1) {
      await sendPlainPrompt(hook!, `ses_default_ulw_cap_${index}`)
    }
    toastMessages.length = 0

    //#when
    await sendPlainPrompt(hook!, "ses_default_ulw_cap_0")

    //#then
    expect(toastMessages).toHaveLength(1)
  })
})
