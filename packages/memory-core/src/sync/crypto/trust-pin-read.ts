// The one read of the trust pin a caller outside the sync engine needs (account.show's `sync` field): whether this
// device holds a pin for an account. Pinning and root changes stay with the sync engine.
export { loadTrustAnchor, type PinLoad } from "./trust-pin"
