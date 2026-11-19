import type { ServiceAuthHooks } from "./commands"

let installed: ServiceAuthHooks | undefined

export function installCliServiceAuthHooks(hooks: ServiceAuthHooks): void {
  installed = hooks
}

/** Hooks installed by `cli-service-auth-hooks.js` from the native device-service hand-off. */
export function openCodeServiceAuthHooks(): ServiceAuthHooks {
  if (installed === undefined) {
    throw new Error("OpenCode service-auth hooks were not installed")
  }
  return installed
}
