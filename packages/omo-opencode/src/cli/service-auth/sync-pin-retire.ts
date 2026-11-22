// The one `beforeKeysDiscarded` every production `createSession` caller passes (#12280): when this
// machine discards a principal's private keys, the memory-sync trust pin that principal earned is
// retired by rename, so a later join pins only through a ceremony. It never throws: a pin it cannot
// retire is logged and the discard goes on (the degraded outcome is a stale pin, never a stalled
// sign-out).

import { hasLiveTrustAnchor, retireSyncDevice } from "@oh-my-opencode/memory-core/sync-device-retire"

import type { BeforeKeysDiscarded, DiscardedCredential } from "./session"

const reason = (error: unknown): string =>
  error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "unknown"

export function retireSyncPinOnDiscard(options: {
  /** The trust-pin directory of the memory root the caller already resolves. */
  readonly pinDir: () => string
  /** The caller's own logger; one line per pin it could not retire. */
  readonly log: (line: string) => void
}): BeforeKeysDiscarded {
  const livePin = () => hasLiveTrustAnchor(options.pinDir()).catch(() => false)
  const hook = async (discarded: DiscardedCredential) => {
    if (discarded.kind === "unreadable") {
      // Nothing is left in place when this machine holds no live pin, so nothing is reported.
      if (await livePin())
        options.log(
          "memory sync: a stored sign-in could not be read when its keys were discarded; its sync pin was left in place",
        )
      return
    }
    const account = discarded.owner?.accountId ?? discarded.accountId
    if (account === undefined) {
      // A sign-in that names no account usually never ran `omo sync` here: no live pin, nothing to say. A live pin left
      // here (a legacy sign-in whose account the service could not be asked for) is kept, and the user is told how to
      // clear it, since `omo account show` keeps answering `joined` for it (#13662). The live pin may as well belong to
      // another account still signed in here (the desktop's), which only the user can tell apart, so the line says so.
      if (await livePin())
        options.log(
          "memory sync: the account of this sign-in is unknown, so a sync pin was kept; if it belongs to this sign-in's account, clear it with `omo account retire-sync --account <id>`. Do not retire the pin of an account that is still signed in here, such as the desktop's.",
        )
      return
    }
    try {
      await retireSyncDevice({ pinDir: options.pinDir(), account })
    } catch (error) {
      options.log(`memory sync: the sync pin could not be retired (${reason(error)}); it was left in place`)
    }
  }
  // A pin earned before the account was stamped on the credential: every discard reads the account from the service first.
  return Object.assign(hook, { wantsAccount: livePin })
}
