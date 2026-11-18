import type {
  RecoverBeginResult,
  RecoverBridgeResult,
  RecoveryBridge,
} from "@oh-my-opencode/memory-core/sync-recovery"
import { z } from "zod"

const REFUSALS = [
  "cancelled",
  "no-prf",
  "no-user-verification",
  "not-enrolled",
  "history-incomplete",
  "key-mismatch",
  "countersign-mismatch",
  "wrap-refused",
  "wrap-unbound",
  "recovery-expired",
] as const
const refused = z.object({ ok: z.literal(false), reason: z.enum(REFUSALS) })
// Shape only: memory-core's recovery path verifies the derived keys against the anchored chain before it
// finishes, and verifies the signed join before it appends anything.
const beginResult = z.union([
  z.object({
    ok: z.literal(true),
    handle: z.string().min(1),
    credentialId: z.string().min(1),
    sealing_public_key: z.string().min(1),
    signing_public_key: z.string().min(1),
  }),
  refused,
])
const finishResult = z.union([
  z.object({
    ok: z.literal(true),
    credentialId: z.string().min(1),
    deviceWrap: z.object({ epoch: z.number().int(), id: z.string(), wrap: z.string() }),
    join: z.object({
      body: z.object({ kind: z.literal("keyring"), account: z.string() }).passthrough(),
      digest: z.string(),
      link: z.string(),
      keyringLink: z.string(),
      recordSig: z.string(),
    }),
  }),
  refused,
])

const unsupported = (what: string) => () => Promise.reject(new Error(`${what} does not run through recovery here`))

/**
 * Recovery on a desktop device (#14122): every step runs in desktop main, which owns the passkey ceremony, the
 * phrase entry window and the derived recovery keys behind a one-shot handle. This side only forwards the public
 * requests and reads back the public results, so neither the phrase nor a private key ever reaches the engine.
 */
export function desktopRecoveryBridge(
  send: (data: Readonly<Record<string, unknown>>) => Promise<unknown>,
  prfSupported: boolean,
): RecoveryBridge {
  return {
    prfSupported,
    enroll: unsupported("Enrollment"),
    enrollPhrase: unsupported("Phrase enrollment"),
    signalRemoved: unsupported("Passkey removal"),
    async recoverBegin(request) {
      return beginResult.parse(await send({ op: "recoverBegin", ...request })) as RecoverBeginResult
    },
    async recoverBeginWithPhrase(request) {
      return beginResult.parse(await send({ op: "recoverBeginPhrase", ...request })) as RecoverBeginResult
    },
    async recoverFinish(request) {
      return finishResult.parse(await send({ op: "recoverFinish", ...request })) as RecoverBridgeResult
    },
    async recoverAbort(handle) {
      await send({ op: "recoverAbort", handle })
    },
  }
}
