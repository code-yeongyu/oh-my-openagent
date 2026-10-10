import { describe, expect, it, mock } from "bun:test"
import { createNativeEditionNudgeHook, NATIVE_NUDGE_TOAST_MESSAGE, NATIVE_NUDGE_TOAST_TITLE } from "./hook"

type ToastCall = { body: { title: string; message: string; variant: string; duration: number } }

function createCtx(showToast?: (arg: ToastCall) => Promise<unknown>) {
  const toasts: ToastCall[] = []
  const ctx = {
    client: showToast
      ? {
          tui: {
            showToast: (arg: ToastCall) => {
              toasts.push(arg)
              return showToast(arg)
            },
          },
        }
      : {},
    directory: "/tmp/test",
  } as unknown as Parameters<typeof createNativeEditionNudgeHook>[0]
  return { ctx, toasts }
}

function sessionCreated(parentID?: string) {
  return {
    event: {
      type: "session.created",
      properties: { info: parentID ? { parentID } : {} },
    },
  }
}

describe("createNativeEditionNudgeHook", () => {
  it("#given a top-level session #then recommends OmO Native with the omo.dev link", async () => {
    const { ctx, toasts } = createCtx(() => Promise.resolve())
    const hook = createNativeEditionNudgeHook(ctx)

    await hook.event(sessionCreated())

    expect(toasts).toHaveLength(1)
    expect(toasts[0]?.body.title).toBe(NATIVE_NUDGE_TOAST_TITLE)
    expect(toasts[0]?.body.message).toBe(NATIVE_NUDGE_TOAST_MESSAGE)
    expect(toasts[0]?.body.message).toContain("https://omo.dev")
  })

  it("#given two session starts #then the toast fires on every launch", async () => {
    const { ctx, toasts } = createCtx(() => Promise.resolve())
    const hook = createNativeEditionNudgeHook(ctx)

    await hook.event(sessionCreated())
    await hook.event(sessionCreated())

    expect(toasts).toHaveLength(2)
  })

  it("#given a child session #then no toast fires", async () => {
    const { ctx, toasts } = createCtx(() => Promise.resolve())
    const hook = createNativeEditionNudgeHook(ctx)

    await hook.event(sessionCreated("ses_parent"))

    expect(toasts).toHaveLength(0)
  })

  it("#given a non-session event #then no toast fires", async () => {
    const { ctx, toasts } = createCtx(() => Promise.resolve())
    const hook = createNativeEditionNudgeHook(ctx)

    await hook.event({ event: { type: "session.idle", properties: {} } })

    expect(toasts).toHaveLength(0)
  })

  it("#given no toast API #then the hook resolves without throwing", async () => {
    const { ctx } = createCtx(undefined)
    const hook = createNativeEditionNudgeHook(ctx)

    await hook.event(sessionCreated())
  })

  it("#given a rejecting toast API #then the hook resolves without throwing", async () => {
    const { ctx } = createCtx(() => Promise.reject(new Error("tui unavailable")))
    const hook = createNativeEditionNudgeHook(ctx)

    await hook.event(sessionCreated())
  })

  it("#given a toast that never settles #then startup is not delayed", async () => {
    let settle: (() => void) | undefined
    const never = new Promise<void>((resolve) => {
      settle = resolve
    })
    const { ctx } = createCtx(() => never)
    const hook = createNativeEditionNudgeHook(ctx)

    const outcome = await Promise.race([
      hook.event(sessionCreated()).then(() => "event-resolved" as const),
      never.then(() => "toast-settled-first" as const),
    ])
    settle?.()

    expect(outcome).toBe("event-resolved")
  })
})
