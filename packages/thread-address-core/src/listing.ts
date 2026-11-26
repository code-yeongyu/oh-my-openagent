/** How a listing round saw a device: answered in full, did not answer in full, or offline in the roster. */
export type DeviceListing = "listed" | "incomplete" | "offline"

/** One listing round: the devices it names incomplete, and each device's own round state when the service reports one. */
export type ListingRound = {
  readonly incomplete: readonly string[]
  /** Per-device round states; every state other than `answered` counts as incomplete. */
  readonly states?: Readonly<Record<string, string>>
}

/** The one listing state for a device, the same for the list and the resolver (design section 6). */
export function deviceListing(
  device: string,
  round: ListingRound,
  roster: readonly { readonly id: string; readonly online: boolean }[],
): DeviceListing {
  if (roster.some((row) => row.id === device && !row.online)) return "offline"
  const state = round.states?.[device]
  return round.incomplete.includes(device) || (state !== undefined && state !== "answered") ? "incomplete" : "listed"
}
