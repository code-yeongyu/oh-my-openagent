import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { sharedSessionArming, type SessionArming } from "../ultrawork/index"
import { TODO_FANOUT_REMINDER } from "./reminder"

const DISABLED_FLAG = "omo-senpi-todo-fanout-reminder-disabled"
const TASK_ADDING_OPS: ReadonlySet<string> = new Set(["init", "append"])

interface TodoResultEvent {
  readonly op: string
  readonly content: ReadonlyArray<Record<string, unknown>>
}

export function createTodoFanoutReminderComponent(
  arming: SessionArming = sharedSessionArming(),
): OmoSenpiComponent {
  return {
    name: "todo-fanout-reminder",
    register(pi: SenpiExtensionAPI, ctx: ComponentContext): void {
      const remindedSessionIds = new Set<string>()
      let anonymousReminded = false

      const isReminded = (sessionId: string | undefined): boolean =>
        sessionId === undefined ? anonymousReminded : remindedSessionIds.has(sessionId)
      const markReminded = (sessionId: string | undefined): void => {
        if (sessionId === undefined) {
          anonymousReminded = true
          return
        }
        remindedSessionIds.add(sessionId)
      }
      const clearReminded = (sessionId: string | undefined): void => {
        if (sessionId === undefined) {
          anonymousReminded = false
          return
        }
        remindedSessionIds.delete(sessionId)
      }

      pi.on("tool_result", (payload: unknown, eventCtx: unknown): { content: ReadonlyArray<Record<string, unknown>> } | undefined => {
        if (ctx.config.getFlag(DISABLED_FLAG) === true) return undefined
        const event = asTodoResultEvent(payload)
        if (event === undefined) return undefined
        if (!TASK_ADDING_OPS.has(event.op)) return undefined
        const sessionId = extractSessionId(eventCtx)
        if (!arming.isArmed(sessionId)) return undefined
        if (isReminded(sessionId)) return undefined
        markReminded(sessionId)
        ctx.logger.info("omo-senpi todo-fanout-reminder injected", { sessionId, op: event.op })
        return { content: [...event.content, { type: "text", text: TODO_FANOUT_REMINDER }] }
      })

      pi.on("session_compact", (payload: unknown, eventCtx: unknown): void => {
        if (isRejectedCompaction(payload)) return
        clearReminded(extractSessionId(eventCtx))
      })

      pi.on("session_shutdown", (_payload: unknown, eventCtx: unknown): void => {
        clearReminded(extractSessionId(eventCtx))
      })
    },
  }
}

function asTodoResultEvent(payload: unknown): TodoResultEvent | undefined {
  if (!isRecord(payload) || payload["type"] !== "tool_result") return undefined
  if (payload["toolName"] !== "todo" || payload["isError"] === true) return undefined
  const input = payload["input"]
  if (!isRecord(input) || typeof input["op"] !== "string") return undefined
  const content = payload["content"]
  if (!Array.isArray(content)) return undefined
  return { op: input["op"], content: content as ReadonlyArray<Record<string, unknown>> }
}

function extractSessionId(eventCtx: unknown): string | undefined {
  if (!isRecord(eventCtx) || !isRecord(eventCtx["sessionManager"])) return undefined
  const getSessionId = eventCtx["sessionManager"]["getSessionId"]
  if (typeof getSessionId !== "function") return undefined
  const id: unknown = getSessionId.call(eventCtx["sessionManager"])
  return typeof id === "string" && id.length > 0 ? id : undefined
}

function isRejectedCompaction(payload: unknown): boolean {
  return isRecord(payload) && "accepted" in payload && payload["accepted"] === false
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
