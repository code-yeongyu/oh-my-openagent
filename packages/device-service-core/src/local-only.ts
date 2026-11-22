// The process-wide "local-only" mark (omo#13440): an `omo remote` verb whose whole call path is the account read plus
// the local API may run without the engine-trust stage, so every network call site this repo owns refuses while the
// mark is set, instead of connecting on trust the stage never filtered. One holder per process through Symbol.for, so
// every bundled copy of this module sees the same mark (the keychain-helper process state uses the same pattern).

const KEY = Symbol.for("omo.local-only-process.v1")

type Holder = { [KEY]?: { marked: boolean } }

function state(): { marked: boolean } {
  const holder = globalThis as Holder
  holder[KEY] ??= { marked: false }
  return holder[KEY]
}

export class LocalOnlyNetworkRefused extends Error {
  readonly code = "local_only_network_refused"
  readonly site: string

  constructor(site: string) {
    super(`a local-only omo remote command reached the network at ${site}`)
    this.site = site
  }
}

export function markLocalOnlyProcess(): void {
  state().marked = true
}

export function isLocalOnlyProcess(): boolean {
  return state().marked
}

/** Throws LocalOnlyNetworkRefused before any I/O when this process is marked local-only. */
export function refuseIfLocalOnly(site: string): void {
  if (state().marked) throw new LocalOnlyNetworkRefused(site)
}
