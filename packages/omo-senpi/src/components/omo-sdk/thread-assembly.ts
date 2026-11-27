import { userInfo } from "node:os"

import { resolveAgentHome } from "../agent-home/resolve-agent-home"
import type { OmoPrincipal, OmoSdkRoot } from "./contract"
import type { OmoSdkOptions } from "./options"
import { assembleRoot } from "./root/assemble"
import { boundaryRefusals } from "./root/authority"
import { threadsNamespace } from "./root/threads"
import { processUid, rootPrincipal } from "./root-principal"

// The thread half of the root, on its own: what the standalone thread SDK runtime (plugin/runtime/thread-sdk) reaches.
// It imports no other namespace's core, so that bundle inlines what it did before the root existed.

export function threadsServing(
  options: OmoSdkOptions,
  env: Readonly<Record<string, string | undefined>>,
  cwd: string,
  principal: OmoPrincipal,
  checkModuleUrl = true,
) {
  const ports = options.ports ?? {}
  return threadsNamespace({
    agentDir: options.agentDir ?? resolveAgentHome({ env }),
    cwd,
    uid: options.uid ?? processUid(),
    user: options.user ?? userInfo().username,
    env,
    principal,
    checkModuleUrl,
    ...(options.endpoint === undefined ? {} : { endpoint: options.endpoint }),
    ...(options.threads === undefined ? {} : { threads: options.threads }),
    ports: {
      ...(ports.host === undefined ? {} : { host: ports.host }),
      ...(ports.store === undefined ? {} : { store: ports.store }),
      ...(ports.remote === undefined ? {} : { remote: ports.remote }),
      ...(ports.now === undefined ? {} : { now: ports.now }),
    },
  })
}

/** What only the compatibility facades reach besides the root: the thread facade's release of a row it located. */
export type FacadeInternals = { readonly releaseLocated: ReturnType<typeof threadsNamespace>["releaseLocated"] }

/**
 * The root the thread facade is a projection of: the threads namespace with every other call answering not_implemented,
 * and the facade's internal member. The public entries export neither this function nor its answer.
 */
export function assembleThreadFacade(options: OmoSdkOptions): { readonly root: OmoSdkRoot } & FacadeInternals {
  const env = options.env ?? process.env
  const cwd = options.cwd ?? process.cwd()
  const principal = rootPrincipal(options)
  const threads = threadsServing(options, env, cwd, principal, false)
  const root = assembleRoot([threads], {}, { env, cwd, principal }, boundaryRefusals(principal, options))
  return { root, releaseLocated: threads.releaseLocated }
}
