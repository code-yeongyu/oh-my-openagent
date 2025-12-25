import type {
  RunContext,
  EventPayload,
  SessionIdleProps,
  SessionStatusProps,
  MessageUpdatedProps,
} from "./types"

export interface EventState {
  mainSessionIdle: boolean
  lastOutput: string
}

export function createEventState(): EventState {
  return {
    mainSessionIdle: false,
    lastOutput: "",
  }
}

export async function processEvents(
  ctx: RunContext,
  stream: AsyncIterable<unknown>,
  state: EventState
): Promise<void> {
  for await (const event of stream) {
    if (ctx.abortController.signal.aborted) break

    try {
      const payload = (event as { payload?: EventPayload }).payload
      if (!payload) continue

      handleSessionIdle(ctx, payload, state)
      handleSessionStatus(ctx, payload, state)
      handleMessageUpdated(ctx, payload, state)
    } catch {}
  }
}

function handleSessionIdle(
  ctx: RunContext,
  payload: EventPayload,
  state: EventState
): void {
  if (payload.type !== "session.idle") return

  const props = payload.properties as SessionIdleProps | undefined
  if (props?.sessionID === ctx.sessionID) {
    state.mainSessionIdle = true
  }
}

function handleSessionStatus(
  ctx: RunContext,
  payload: EventPayload,
  state: EventState
): void {
  if (payload.type !== "session.status") return

  const props = payload.properties as SessionStatusProps | undefined
  if (props?.sessionID === ctx.sessionID && props?.status?.type === "busy") {
    state.mainSessionIdle = false
  }
}

function handleMessageUpdated(
  ctx: RunContext,
  payload: EventPayload,
  state: EventState
): void {
  if (payload.type !== "message.updated") return

  const props = payload.properties as MessageUpdatedProps | undefined
  if (props?.info?.sessionID !== ctx.sessionID) return
  if (props?.info?.role !== "assistant") return

  const content = props.content
  if (!content || content === state.lastOutput) return

  const newContent = content.slice(state.lastOutput.length)
  if (newContent) {
    process.stdout.write(newContent)
  }
  state.lastOutput = content
}
