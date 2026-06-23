import type { DeepSeekFrame } from "./openai-sse-frame-helpers"

export type FragmentType = "THINK" | "RESPONSE"

export type Fragment = { id: number; type: FragmentType }

export type FragmentEvent =
  | { kind: "reasoning"; text: string }
  | { kind: "content"; text: string }
  | null

export type FragmentTracker = {
  feed(parsed: DeepSeekFrame, currentPath: string): FragmentEvent[]
  fragments(): ReadonlyArray<Fragment>
}

const FRAGMENT_CONTENT_PATH = "response/fragments/-1/content"
const FRAGMENT_LIST_PATH = "response/fragments"
const LEGACY_CONTENT_PATH = "response/content"

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x)
}

function asFragmentLike(
  x: unknown,
): { id: number; type: FragmentType; content?: unknown } | null {
  if (!isObject(x)) return null
  const id = x.id
  const type = x.type
  if (typeof id !== "number") return null
  if (type !== "THINK" && type !== "RESPONSE") return null
  return { id, type, content: x.content }
}

function eventForType(type: FragmentType, text: string): FragmentEvent {
  return type === "THINK"
    ? { kind: "reasoning", text }
    : { kind: "content", text }
}

function readInitialFragments(parsedV: unknown): unknown[] | null {
  if (!isObject(parsedV)) return null
  const response = parsedV.response
  if (!isObject(response)) return null
  if (!Array.isArray(response.fragments)) return null
  return response.fragments
}

export function createFragmentTracker(): FragmentTracker {
  const fragments: Fragment[] = []
  const seedFragmentList = (
    list: ReadonlyArray<unknown>,
    events: FragmentEvent[],
  ): void => {
    for (const raw of list) {
      const f = asFragmentLike(raw)
      if (!f) continue
      fragments.push({ id: f.id, type: f.type })
      if (typeof f.content === "string" && f.content.length > 0) {
        events.push(eventForType(f.type, f.content))
      }
    }
  }
  return {
    feed(parsed, currentPath) {
      const events: FragmentEvent[] = []
      const initialList = readInitialFragments(parsed.v)
      if (initialList !== null) {
        seedFragmentList(initialList, events)
        return events
      }
      if (
        parsed.p === FRAGMENT_LIST_PATH &&
        parsed.o === "APPEND" &&
        Array.isArray(parsed.v)
      ) {
        seedFragmentList(parsed.v, events)
        return events
      }
      if (
        currentPath === FRAGMENT_CONTENT_PATH &&
        typeof parsed.v === "string"
      ) {
        const last = fragments[fragments.length - 1]
        if (last) events.push(eventForType(last.type, parsed.v))
        return events
      }
      if (currentPath === LEGACY_CONTENT_PATH && typeof parsed.v === "string") {
        events.push({ kind: "content", text: parsed.v })
        return events
      }
      return events
    },
    fragments() {
      return fragments
    },
  }
}
