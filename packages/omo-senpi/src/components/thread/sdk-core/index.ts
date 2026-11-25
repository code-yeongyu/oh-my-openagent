import { createThreadCoreContext, type ThreadCoreOptions } from "./context"
import { createControls } from "./controls"
import { createLifecycle } from "./lifecycle"
import { createReads } from "./reads"
import { createSend } from "./send"

export type { ThreadCoreOptions } from "./context"
export type { CoreReleaseRequest } from "./lifecycle"
export type { CoreListRequest, CoreLocateResult, CoreReadRequest, LocatedThread } from "./reads"
export type { CoreSendRequest, CoreSendResult } from "./send"

/**
 * The thread core: every operation the agent tools offer, over the same address book and engine, without an agent
 * session, in the root's own vocabulary. It never starts a host; it reads the endpoints the engine enumerates and the
 * gateway store under `agentDir`, as principal `cli:<uid>`.
 */
export function createThreadCore(options: ThreadCoreOptions) {
  const context = createThreadCoreContext(options)
  const reads = createReads(context)
  const lifecycle = createLifecycle(context, reads.locate)
  return {
    principal: context.principal,
    ...reads,
    send: createSend(context),
    ...createControls(context),
    ...lifecycle,
    extensions: {
      register: context.store.registerStoreExtension,
      call: context.store.extensionCall,
    },
  }
}

export type ThreadCore = ReturnType<typeof createThreadCore>
