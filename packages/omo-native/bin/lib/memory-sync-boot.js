import { isEngineCommand } from "./engine-commands.js"

// #11997: a `--mode rpc` engine whose launch carried a private-descriptor table naming memory-sync starts that claim
// before senpi's CLI loads, because a multi-session host (what `host ensure` starts) loads extensions only when a
// session opens, and the desktop opens none before it has answered the claim's bootstrap frame. The launch rules are
// the device-account sidecar's `claimsMemorySyncAtBoot` (omo-senpi desktop-sync/bootGate.ts), which every entry, the
// desktop's included, calls; each omo entry passes it in from where it loads omo-senpi. omo adds only its own one-shot
// engine commands on top.

/**
 * Whether this omo launch should claim memory sync at boot: not an omo one-shot engine command, and the shared gate.
 * @param {readonly string[]} args
 * @param {Readonly<Record<string, string | undefined>>} env
 * @param {(args: readonly string[], env?: Readonly<Record<string, string | undefined>>, runtime?: { readonly execArgv: readonly string[], readonly versions: { readonly bun?: string | undefined } }) => boolean} claimsMemorySyncAtBoot
 * @param {{ readonly execArgv: readonly string[], readonly versions: { readonly bun?: string | undefined } }} [runtime]
 */
export function launchClaimsMemorySyncAtBoot(args, env, claimsMemorySyncAtBoot, runtime = process) {
  return !isEngineCommand(args) && claimsMemorySyncAtBoot(args, env, runtime)
}
