import type { CapturedUi } from "./runtime-context"

export const SOCKET_A = "/tmp/dh-t10/rpc/shards/p-aaaaaaaaaaaaaaaa.sock"

type Notified = { readonly text: string; readonly type: string | undefined }

export function uiRecorder(): { readonly ui: CapturedUi; readonly notified: Notified[] } {
  const notified: Notified[] = []
  const ui: CapturedUi = {
    notify: (text, type) => notified.push({ text, type }),
    setStatus: () => undefined,
    setWidget: () => undefined,
    select: () => Promise.resolve(undefined),
    confirm: () => Promise.resolve(false),
  }
  return { ui, notified }
}

export function linesWith(lines: readonly string[], token: string): readonly string[] {
  return lines.filter((line) => line.startsWith(`${token}:`))
}

/** The warning's child count: the last integer on the line. */
export function reattachingCount(line: string): number {
  return Number(line.match(/\d+/g)?.at(-1))
}

/**
 * The done line's counts, read by their words: "<R> subagent(s) reattached, 0 lost" or
 * "<L> subagent(s) lost (reattach failed), <R> reattached", then ", <C> cancelled" when any were.
 * The Desktop parses the same shape.
 */
export function doneCounts(line: string): { readonly reattached: number; readonly lost: number; readonly cancelled: number } {
  const body = line.slice(line.indexOf(" ") + 1)
  const reattached = body.match(/(\d+) (?:subagents? )?reattached/)
  const lost = body.match(/(\d+) (?:subagents? )?lost/)
  const cancelled = body.match(/(\d+) cancelled/)
  return { reattached: Number(reattached?.[1] ?? Number.NaN), lost: Number(lost?.[1] ?? Number.NaN), cancelled: Number(cancelled?.[1] ?? 0) }
}
