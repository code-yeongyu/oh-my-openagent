import type { PanelContextUsage } from "../sections/context"
import type { PanelSessionTotals } from "../sections/session"

/**
 * The live facts the panel reads off an event context. senpi does not declare these on the
 * adapter's structural ports, so each one is guarded and simply stays absent when the host
 * does not offer it - a panel with one missing row beats a panel that throws mid-frame.
 */
export interface PanelHostFacts {
  readonly model?: string
  readonly usage?: PanelContextUsage
  readonly totals?: PanelSessionTotals
  readonly sessionId?: string
}

export function panelFactsFrom(value: unknown): PanelHostFacts {
  if (!isRecord(value)) return {}
  return {
    ...optional("model", modelName(value["model"])),
    ...optional("usage", contextUsage(call(value, "getContextUsage"))),
    ...optional("sessionId", sessionId(value["sessionManager"])),
    ...optional("totals", usageTotals(value["sessionManager"])),
  }
}

/** `provider/model-id` reads as noise in a narrow column; the tail identifies the model. */
function modelName(value: unknown): string | undefined {
  if (typeof value === "string") return shortModel(value)
  if (!isRecord(value)) return undefined
  for (const key of ["id", "name"]) {
    const candidate = value[key]
    if (typeof candidate === "string" && candidate !== "") return shortModel(candidate)
  }
  return undefined
}

function shortModel(id: string): string {
  const slash = id.lastIndexOf("/")
  return slash === -1 ? id : id.slice(slash + 1)
}

function contextUsage(value: unknown): PanelContextUsage | undefined {
  if (!isRecord(value)) return undefined
  const tokens = value["tokens"]
  const contextWindow = value["contextWindow"]
  const percent = value["percent"]
  if (typeof contextWindow !== "number") return undefined
  return {
    tokens: typeof tokens === "number" ? tokens : null,
    contextWindow,
    percent: typeof percent === "number" ? percent : null,
  }
}

function usageTotals(manager: unknown): PanelSessionTotals | undefined {
  const totals = call(manager, "getUsageTotals")
  if (!isRecord(totals)) return undefined
  const input = totals["input"]
  const output = totals["output"]
  if (typeof input !== "number" || typeof output !== "number") return undefined
  const hitRate = totals["latestCacheHitRate"]
  return {
    input,
    output,
    cacheRead: numberOr(totals["cacheRead"], 0),
    cacheWrite: numberOr(totals["cacheWrite"], 0),
    cost: numberOr(totals["cost"], 0),
    ...(typeof hitRate === "number" ? { latestCacheHitRate: hitRate } : {}),
  }
}

function sessionId(manager: unknown): string | undefined {
  const id = call(manager, "getSessionId")
  return typeof id === "string" && id !== "" ? id : undefined
}

/** Call a host method that may not exist, and never let its failure reach the render loop. */
function call(owner: unknown, method: string): unknown {
  if (!isRecord(owner)) return undefined
  const fn = owner[method]
  if (typeof fn !== "function") return undefined
  try {
    return Reflect.apply(fn, owner, [])
  } catch {
    return undefined
  }
}

function optional<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>)
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
