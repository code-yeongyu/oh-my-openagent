import assert from "node:assert/strict"

import { bounded, openProducerKernel, type ProducerKernel } from "./omp-item6-harness"

export const DEFINE_CELL = [
  "tool(async function fixture_lookup(key) { return 'parent-state:' + key; });",
  "return await tool.hold({});",
].join("\n")

/**
 * A REAL producer kernel holding an open cell that has defined `fixture_lookup`. The cell parks on
 * `tool.hold`, so the definition stays live (and the kernel generation stable) until `release()`.
 */
export async function definedKernel(sessionId: string): Promise<{ kernel: ProducerKernel; release: () => void }> {
  const kernel = await openProducerKernel(sessionId)
  const cell = kernel.run({ cellId: `${sessionId}-cell`, code: DEFINE_CELL })
  const hold = await bounded(kernel.nextToolCall(), "hold-call")
  assert.equal(hold.toolName, "hold")
  return { kernel, release: () => { kernel.reply(hold.callId, "released"); void cell } }
}
