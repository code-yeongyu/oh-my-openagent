// Cycle records written by pre-merge builds of #10548 (never released) carried the render inline:
// `texts` (key -> rendered text, from stage rendered on) and `progress` (key -> { text, done } at
// stage merged), with no render journal. Such a record is read here so a resumed cycle still
// adopts the renders that landed as baselines (apply.ts invariant 5), instead of capturing them
// back as this device's own edits.
//
// This is weaker than invariant 5. Those records never stored the doc's frontier, so adoption can
// only check that the doc still renders to the recorded text, not that it is still at the version
// the render came from: an edit that leaves the same text is indistinguishable. Only keys the store
// already knows are adopted, so a damaged or hand-edited record cannot create an item (#10620).

import type { EngineDeps } from "./engine-deps"
import type { CycleRecord } from "./journal"

interface LegacyRender {
  readonly text: string | null
  /** True when the record proves the render landed; otherwise only a matching working file does. */
  readonly landed: boolean
}

const isObject = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null

const isText = (value: unknown): value is string | null => value === null || typeof value === "string"

function legacyRenders(cycle: CycleRecord): Map<string, LegacyRender> {
  const renders = new Map<string, LegacyRender>()
  if ("progress" in cycle && isObject(cycle.progress)) {
    for (const [key, step] of Object.entries(cycle.progress)) {
      if (isObject(step) && isText(step.text)) renders.set(key, { text: step.text, landed: step.done === true })
    }
  }
  if ("texts" in cycle && isObject(cycle.texts) && cycle.stage !== "merged") {
    for (const [key, text] of Object.entries(cycle.texts)) if (isText(text)) renders.set(key, { text, landed: true })
  }
  return renders
}

/** Adopts each legacy render of a key without a render record while the doc still renders to it. */
export async function adoptLegacyRenders(
  deps: EngineDeps,
  cycle: CycleRecord,
  recorded: ReadonlySet<string>,
  readWorking: (key: string) => Promise<string | null>,
): Promise<void> {
  const known = new Set(deps.store.keys())
  for (const [key, render] of legacyRenders(cycle)) {
    if (recorded.has(key) || !known.has(key)) continue
    if (deps.store.render(key, render.text) !== render.text) continue
    if (!render.landed && (await readWorking(key)) !== render.text) continue
    await deps.store.markMaterialized(key, render.text)
  }
}
