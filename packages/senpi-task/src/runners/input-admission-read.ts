import type { InputAdmission } from "./input-effects"
import type { RpcProtocolClient } from "./rpc/protocol-client"
import type { HostSessionPort } from "./rpc-host/handle-port"

/** `get_pending_inputs` answers at most this many `knownClientMessageIds` per read (senpi#3549). */
const MAX_IDS_PER_READ = 64

type Outcome = { readonly clientMessageId: string; readonly status: InputAdmission }
/** One batch's outcomes, or `"unsupported"` when the child has no such read at all. */
type BatchAnswer = readonly Outcome[] | "unsupported"

/**
 * The child's admission of each id, read through its daemon session. A port without the read answers
 * `undefined` (the caller keeps its same-id resend); a failed read throws, so the input stays uncertain.
 */
export async function readHostAdmissions(
  port: Pick<HostSessionPort, "getPendingInputs">,
  ids: readonly string[],
): Promise<ReadonlyMap<string, InputAdmission> | undefined> {
  if (port.getPendingInputs === undefined) return undefined
  return collect(ids, async batch => (await port.getPendingInputs?.(batch))?.outcomes ?? "unsupported")
}

/**
 * The same read over a stdio child. Only an "unknown command" refusal means the child cannot read
 * admissions (an engine before senpi#3549), which keeps the same-id resend; any other refusal or a lost
 * answer throws, so the input stays uncertain and nothing is sent.
 */
export async function readStdioAdmissions(
  client: Pick<RpcProtocolClient, "send">,
  ids: readonly string[],
): Promise<ReadonlyMap<string, InputAdmission> | undefined> {
  return collect(ids, async batch => {
    const response = await client.send({ type: "get_pending_inputs", knownClientMessageIds: [...batch] })
    if (response.success && response.command === "get_pending_inputs") return response.data.outcomes
    if (!response.success && /unknown command/iu.test(response.error)) return "unsupported"
    throw new Error(`get_pending_inputs refused: ${response.success ? response.command : response.error}`)
  })
}

async function collect(
  ids: readonly string[],
  readBatch: (batch: readonly string[]) => Promise<BatchAnswer>,
): Promise<ReadonlyMap<string, InputAdmission> | undefined> {
  const admissions = new Map<string, InputAdmission>()
  for (let start = 0; start < ids.length; start += MAX_IDS_PER_READ) {
    const answer = await readBatch(ids.slice(start, start + MAX_IDS_PER_READ))
    if (answer === "unsupported") return undefined
    for (const outcome of answer) admissions.set(outcome.clientMessageId, outcome.status)
  }
  // The engine answers every id it is asked about. An id left out is never read as not admitted.
  const missing = ids.filter(id => !admissions.has(id))
  if (missing.length > 0) throw new Error(`get_pending_inputs left out ${missing.length} id(s)`)
  return admissions
}
