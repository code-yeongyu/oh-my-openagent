import type { HelperAccess } from "./access"
import type { HelperCall, HelperLease, HelperReply } from "./client"
import { type DedicatedStoreState, dedicatedStoreRefusal } from "./dedicated-store"

/**
 * Turning OmO's own keychain on and off (#13116 design r2, finding 2). Both run inside the credential lock that every
 * refresh write takes, and the `active` marker is written last on enable and removed first on disable, so at every
 * step exactly one store is authoritative: a crash leaves either the old store selected with the sign-in still in it,
 * or the new one selected with the sign-in already copied and read back.
 */
export type StoreSwitchDeps = {
  readonly access: Extract<HelperAccess, { kind: "ready" }>
  readonly account: string
  readonly lease: HelperLease
  readonly state: () => DedicatedStoreState
}

/** How the login keychain's sign-in was handled: moved, absent, or left there because it could not be read silently. */
export type EnableMove = "copied" | "none" | "kept-active" | "left-locked" | "left-unreadable"
export type EnableOutcome = { readonly created: boolean; readonly moved: EnableMove; readonly loginLeftover: boolean }
export type DisableOutcome = {
  readonly moved: "copied" | "none"
  readonly erased: boolean
  readonly damagedLeftInPlace?: true
}

export class StoreSwitchError extends Error {}

const LOGIN_LOCKED =
  "The login keychain is locked, so the sign-in cannot be moved back and nothing was changed. Sign in at this Mac's screen (or unlock the login keychain) and run omo account store disable again, or run omo logout and then omo account store disable --discard."

function refused(reply: HelperReply, step: string): StoreSwitchError {
  return new StoreSwitchError(
    dedicatedStoreRefusal(reply) ?? `OmO's keychain helper could not ${step} (${reply.error ?? "no answer"}).`,
  )
}

export function storeSwitch(deps: StoreSwitchDeps) {
  const call = (request: Omit<HelperCall, "account">) =>
    deps.access.call({ ...request, account: deps.account }, deps.lease)
  const ok = async (request: Omit<HelperCall, "account">, step: string): Promise<HelperReply> => {
    const reply = await call(request)
    if (reply.ok !== true) throw refused(reply, step)
    return reply
  }
  const removeLogin = async (): Promise<boolean> => {
    const removed = await call({ verb: "remove", store: "login" })
    return removed.ok === true
  }
  const copy = async (value: string, to: "omo-migrate" | "login", step: string): Promise<void> => {
    const written = await call({ verb: "write", value, store: to })
    if (written.error === "locked" && to === "login") throw new StoreSwitchError(LOGIN_LOCKED)
    if (written.ok !== true) throw refused(written, step)
    const back = await call({ verb: "read", store: to })
    if (back.value !== value) throw new StoreSwitchError(`The sign-in did not read back after it was copied (${step}).`)
  }

  return {
    async enable(): Promise<EnableOutcome> {
      const wasActive = deps.state() === "active"
      const created = (await ok({ verb: "store-create", store: "omo" }, "create OmO's keychain")).created === true
      const login = await call({ verb: "read", store: "login" })
      if (wasActive) {
        // A rerun after a crash between activation and cleanup: OmO's keychain is authoritative; only a leftover
        // login copy is removed, and only when OmO's keychain holds the sign-in.
        const current = await call({ verb: "read", store: "omo" })
        const loginPresent = login.error === undefined && login.missing !== true
        const removed = loginPresent && login.owned === true && current.value !== undefined && (await removeLogin())
        return { created, moved: "kept-active", loginLeftover: loginPresent && !removed }
      }
      // An inactive store is never authoritative (the same rule disable follows): whatever an earlier, interrupted
      // enable left in it is dropped before activation, so it can never come back as the live sign-in (review M1).
      await ok({ verb: "remove", store: "omo-migrate" }, "clear OmO's keychain before enabling it")
      await deps.access.call({ verb: "remove", account: `${deps.account}.staging`, store: "omo-migrate" }, deps.lease)
      let moved: EnableMove = "none"
      if (login.error === "locked") moved = "left-locked"
      else if (login.error !== undefined) throw refused(login, "read the login keychain")
      else if (login.owned === true && login.value !== undefined) {
        await copy(login.value, "omo-migrate", "copy into OmO's keychain")
        moved = "copied"
      } else if (login.missing !== true) moved = "left-unreadable"
      await ok({ verb: "store-activate", store: "omo" }, "activate OmO's keychain")
      const loginLeftover = moved === "copied" ? !(await removeLogin()) : moved !== "none"
      return { created, moved, loginLeftover }
    },

    async disable(discard: boolean): Promise<DisableOutcome> {
      const state = deps.state()
      if (state === "absent") return { moved: "none", erased: false }
      let moved: DisableOutcome["moved"] = "none"
      // An inactive store is never authoritative: whatever it holds is a leftover from an enable or disable that
      // stopped early, older than the login keychain's sign-in, so it is dropped and never copied over it.
      const current: HelperReply = state === "active" ? await call({ verb: "read", store: "omo-migrate" }) : {}
      // A damaged store (wrong mode, bad key) refuses every read; --discard still turns it off, so store-less requests
      // work again, and leaves the folder for the user to delete (review L1).
      const damaged = current.error === "store-refused"
      if (current.error !== undefined && !(damaged && discard))
        throw new StoreSwitchError(
          `${refused(current, "read OmO's keychain").message}${damaged ? " To turn it off anyway, run omo account store disable --discard." : ""}`,
        )
      if (damaged) {
        await ok({ verb: "store-deactivate", store: "omo" }, "deactivate OmO's keychain")
        return { moved: "none", erased: false, damagedLeftInPlace: true }
      }
      if (current.value !== undefined) {
        if (discard)
          throw new StoreSwitchError(
            "OmO's own keychain still holds a sign-in. Run omo logout first, then run --discard again.",
          )
        await copy(current.value, "login", "copy back into the login keychain")
        moved = "copied"
      }
      if (state === "active") await ok({ verb: "store-deactivate", store: "omo" }, "deactivate OmO's keychain")
      // A store whose keychain file is already gone (a crash inside an earlier erase) answers "missing" here; the
      // erase below finishes it (code review r2).
      const removed = await call({ verb: "remove", store: "omo-migrate" })
      const gone = removed.error === "store-refused" && removed.reason === "missing"
      if (removed.ok !== true && !gone) throw refused(removed, "remove the sign-in from OmO's keychain")
      if (!gone)
        await deps.access.call({ verb: "remove", account: `${deps.account}.staging`, store: "omo-migrate" }, deps.lease)
      await ok({ verb: "store-erase", store: "omo" }, "erase OmO's keychain")
      return { moved, erased: true }
    },
  }
}
