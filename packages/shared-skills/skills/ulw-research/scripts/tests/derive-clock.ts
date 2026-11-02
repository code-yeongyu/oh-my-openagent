import { derive as deriveAt } from "../fact-derive.mjs"

// All successful test derivations use caller-owned, fixed observation time.
export const derive = (ledger: unknown, spec: unknown) => deriveAt(ledger, spec !== null && typeof spec === "object" && !Array.isArray(spec) ? { now: "2026-10-23T08:00:00Z", ...spec } : spec)
