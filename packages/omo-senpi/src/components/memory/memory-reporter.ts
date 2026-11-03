import { recallMemoryFigures } from "@oh-my-opencode/memory-core"
import type { SenpiExtensionAPI } from "../../extension/types"

/**
 * The recall layer of senpi's on-demand memory report (oh-my-openagent#9442): the parsed memory corpus
 * every recall cache in this process holds and its BM25 term arrays. Read only when a report is taken.
 */
export function registerRecallMemoryReporter(pi: Pick<SenpiExtensionAPI, "registerMemoryReporter">): void {
  pi.registerMemoryReporter?.("omoRecall", () => ({ ...recallMemoryFigures() }))
}
