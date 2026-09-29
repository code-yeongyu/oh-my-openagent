import { AdapterRefusal, type InboundEvent, type RefusedCapability, type SurfaceAdapter } from "../contract"
import { ConformanceFailure } from "./types"

export function expect(condition: boolean, message: string): asserts condition {
  if (!condition) throw new ConformanceFailure(message)
}

export async function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ConformanceFailure(`waited ${ms} ms for ${what}; it never happened`)), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Start `adapter.listen`, wait for its ready signal, run `trigger`, and collect the events whose
 * text contains each marker until every marker was seen. Stops listening afterwards and requires
 * `listen` to resolve on abort.
 */
export async function collectInbound(
  adapter: SurfaceAdapter,
  markers: readonly string[],
  trigger: () => Promise<void>,
  ms: number,
): Promise<Map<string, InboundEvent[]>> {
  const seen = new Map<string, InboundEvent[]>(markers.map((marker) => [marker, []]))
  const controller = new AbortController()
  let resolveAll: () => void = () => undefined
  const allSeen = new Promise<void>((resolve) => {
    resolveAll = resolve
  })
  let resolveReady: () => void = () => undefined
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve
  })
  const onEvent = (event: InboundEvent) => {
    for (const marker of markers) if (event.text.includes(marker)) seen.get(marker)?.push(event)
    if ([...seen.values()].every((events) => events.length > 0)) resolveAll()
  }
  const listening = adapter.listen(onEvent, controller.signal, resolveReady).then(
    () => null,
    (error: unknown) => error,
  )
  try {
    await within(ready, ms, "listen to call ready()")
    await trigger()
    await within(allSeen, ms, `inbound events carrying ${markers.join(", ")}`)
  } finally {
    controller.abort()
  }
  const failed = await within(listening, ms, "listen to resolve after abort")
  expect(failed === null, `listen rejected: ${String(failed)}`)
  return seen
}

export async function collectCatchUp(adapter: SurfaceAdapter, since: string, threads: Parameters<SurfaceAdapter["catchUp"]>[1], ms: number): Promise<InboundEvent[]> {
  const events: InboundEvent[] = []
  const drain = async () => {
    for await (const event of adapter.catchUp(since, threads)) events.push(event)
  }
  await within(drain(), ms, "catchUp to finish")
  return events
}

export async function expectRefusal(send: () => Promise<unknown>, capabilities: readonly RefusedCapability[], what: string): Promise<void> {
  try {
    await send()
  } catch (error) {
    expect(error instanceof AdapterRefusal, `${what} failed with ${String(error)} instead of an AdapterRefusal`)
    expect(capabilities.includes(error.capability), `${what} was refused for ${error.capability}, expected one of ${capabilities.join(", ")}`)
    return
  }
  throw new ConformanceFailure(`${what} succeeded although the adapter reports ${capabilities.join(" / ")} as unavailable`)
}
