import type { ControlConfirmRequest } from "@oh-my-opencode/senpi-desktop-tool"

/** Who holds the device foreground: the issuer of the session and the execution scope it runs in. */
export interface LeaseOwner {
  readonly issuer: string
  readonly scope: string
}

export type LeaseAcquisition = { readonly granted: true } | { readonly granted: false; readonly heldBy: LeaseOwner }

/**
 * One device foreground shared by every session in this process. On a hand of a split session each execution
 * scope runs its own computer-use component and engine connection, so without this arbiter two scopes could both
 * drive the same screen at once. Fused sessions do not use it: their behaviour stays exactly today's.
 */
export interface ForegroundLease {
  /** Grants a free lease, re-grants it to its holder, and refuses anyone else while it is held. */
  acquire(owner: LeaseOwner): LeaseAcquisition
  /** Releases the lease only when `owner` holds it; another owner's release changes nothing. */
  release(owner: LeaseOwner): void
  holder(): LeaseOwner | undefined
}

function sameOwner(a: LeaseOwner, b: LeaseOwner): boolean {
  return a.issuer === b.issuer && a.scope === b.scope
}

export function createForegroundLease(): ForegroundLease {
  let held: LeaseOwner | undefined
  return {
    acquire(owner) {
      if (held === undefined || sameOwner(held, owner)) {
        held = owner
        return { granted: true }
      }
      return { granted: false, heldBy: held }
    },
    release(owner) {
      if (held !== undefined && sameOwner(held, owner)) held = undefined
    },
    holder: () => held,
  }
}

type ConfirmControl = (request: ControlConfirmRequest) => Promise<boolean>

/**
 * Puts a hand's grant decision behind the shared lease: a scope whose foreground another scope holds is refused
 * before its own consent is consulted, and a granted decision records the scope as the holder. The caller
 * releases the lease on the scope's revoke, stop or close.
 */
export function leasedConfirmControl(confirm: ConfirmControl, lease: ForegroundLease, owner: () => LeaseOwner): ConfirmControl {
  return async (request) => {
    const current = lease.holder()
    if (current !== undefined && !sameOwner(current, owner())) return false
    if (!(await confirm(request))) return false
    return lease.acquire(owner()).granted
  }
}
