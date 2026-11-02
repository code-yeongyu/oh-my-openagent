// A task shard's supervisor only owns the public socket and restarts its host, yet entering the
// engine through `dist/cli.js` evaluates the whole `main.js` graph before `main()` dispatches the
// route, once per shard. The binary enters the engine's own route module instead. The imports stay
// relative literals: the files are outside senpi's exports map, and bun only traces literal
// import() arguments into the compiled binary.

import { launchOptions } from "./compile-args"

/** Must equal the engine's `INTERNAL_SUPERVISOR_ROUTE_FLAG` (`modes/rpc/supervisor-route.ts`). */
export const INTERNAL_SUPERVISOR_FLAG = "--internal-rpc-host-supervisor"

export function isInternalSupervisorLaunch(args: readonly string[]): boolean {
  return launchOptions(args).includes(INTERNAL_SUPERVISOR_FLAG)
}

/**
 * Applies the process setup the engine's `cli.ts`/`cli-main.ts` run before `main()`, then the
 * engine route. False means the engine declined the argv, and the caller continues into the full
 * CLI exactly as before.
 */
export async function runInternalSupervisor(args: readonly string[]): Promise<boolean> {
  await import("../../node_modules/@code-yeongyu/senpi/dist/valid-cwd.js")
  const { APP_NAME } = await import("../../node_modules/@code-yeongyu/senpi/dist/config.js")
  process.title = APP_NAME
  process.env.PI_CODING_AGENT = "true"
  process.env.AI_AGENT = APP_NAME
  process.emitWarning = (): void => {}
  const { dispatchInternalSupervisor } = await import(
    "../../node_modules/@code-yeongyu/senpi/dist/modes/rpc/supervisor-route.js"
  )
  return dispatchInternalSupervisor(args)
}
