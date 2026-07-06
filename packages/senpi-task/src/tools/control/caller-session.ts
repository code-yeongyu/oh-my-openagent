import type { CallerSessionResolver } from "./types"

// The component (todo 17) wires this from the live ExtensionContext. The control tools ALWAYS call
// it and pass the result into every steering/list call so the scope guard is never fail-open in
// production (W1-V seam obligation 1).
export const defaultResolveCallerSessionId: CallerSessionResolver = (ctx) => ctx.sessionManager.getSessionId()
