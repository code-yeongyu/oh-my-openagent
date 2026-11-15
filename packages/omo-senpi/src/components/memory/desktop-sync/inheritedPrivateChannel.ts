// The sidecar's copy of senpi's private-descriptor capture. Module order is the contract: the restore evaluates first
// and puts a deferred fallback-path declaration back into process.env, then senpi's capture reads it and removes it
// again, with no other code running in between (#12057).
import "./restoreDeferredDeclaration"

export { takeInheritedPrivateChannel } from "#senpi-private-fds"
