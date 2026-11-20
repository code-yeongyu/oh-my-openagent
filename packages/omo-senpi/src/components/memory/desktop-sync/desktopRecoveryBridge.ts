import { z } from "zod"
import {
  RECOVER_REFUSALS,
  type RecoverBeginResult,
  type RecoverBridgeResult,
  type RecoverySessionBridge,
} from "@oh-my-opencode/memory-core/sync-engine"
import type { DesktopSyncOperationHandle } from "./desktopSyncOperation"

const text = z.string().min(1).max(4096)
const refusal = z.enum(RECOVER_REFUSALS)
const wrap = z.strictObject({ epoch: z.number().int().min(0), id: text, wrap: z.string().min(1) })

/** Only public values cross: the hints served before verification, never anything the person typed (D12 test 6). */
export const phraseBeginData = z.strictObject({
  account: text,
  hints: z
    .array(
      z.strictObject({
        credentialId: text,
        enrollmentNonce: text,
        sealing_public_key: text,
        signing_public_key: text,
      }),
    )
    .max(16),
})

const beginReply = z.union([
  z.strictObject({
    op: z.literal("recoverBegin"),
    ok: z.literal(true),
    handle: text,
    credentialId: text,
    sealing_public_key: text,
    signing_public_key: text,
  }),
  z.strictObject({ op: z.literal("recoverBegin"), ok: z.literal(false), reason: refusal }),
])
// The join's body is re-verified by memory-core before it is appended; shape only here.
const finishReply = z.union([
  z.strictObject({
    op: z.literal("recoverFinish"),
    ok: z.literal(true),
    credentialId: text,
    deviceWrap: wrap,
    join: z.strictObject({
      body: z.object({ kind: z.literal("recovery-join"), account: text }).passthrough(),
      digest: text,
      link: text,
      keyringLink: text,
      recordSig: text,
    }),
  }),
  z.strictObject({ op: z.literal("recoverFinish"), ok: z.literal(false), reason: refusal }),
])
const abortReply = z.strictObject({ op: z.literal("recoverAbort") })

type Report = (code: "bridge_result_invalid") => void
const invalid = { ok: false, reason: "unavailable" } as const

/**
 * The engine side of recovery in desktop main (D12 section 1, private channel): every request goes over this
 * operation's main-issued handle and carries only public values; the words, the PRF output and the derived private
 * keys stay in main. A reply that does not decode becomes `unavailable`, and only its closed code is reported.
 */
export function desktopRecoveryBridge(
  operation: Pick<DesktopSyncOperationHandle, "request">,
  prfSupported: boolean,
  report: Report,
): RecoverySessionBridge {
  const decode = <T extends { readonly op: string }>(
    schema: z.ZodType<T>,
    reply: unknown,
  ): Omit<T, "op"> | typeof invalid => {
    const parsed = schema.safeParse(reply)
    if (!parsed.success) {
      report("bridge_result_invalid")
      return invalid
    }
    const { op: _op, ...result } = parsed.data
    return result
  }
  return {
    prfSupported,
    async recoverBeginWithPhrase(request) {
      const data = phraseBeginData.parse({ account: request.account, hints: request.hints })
      return decode(beginReply, await operation.request({ op: "recoverBeginPhrase", data })) as RecoverBeginResult
    },
    async recoverBegin(request) {
      const data = {
        account: request.account,
        rpId: request.rpId,
        salts: request.salts.map((salt) => ({
          credentialId: salt.credentialId,
          enrollmentNonce: salt.enrollmentNonce,
        })),
        knownCredentialIds: [...request.knownCredentialIds],
        acknowledgeUnknown: request.acknowledgeUnknown,
      }
      return decode(beginReply, await operation.request({ op: "recoverBegin", data })) as RecoverBeginResult
    },
    async recoverFinish(request) {
      return decode(finishReply, await operation.request({ op: "recoverFinish", data: request })) as RecoverBridgeResult
    },
    async recoverAbort(handle) {
      decode(abortReply, await operation.request({ op: "recoverAbort", data: { handle } }))
    },
  }
}
