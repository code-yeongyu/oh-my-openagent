import { configureSharedSubunitLogger } from "@oh-my-opencode/utils"
import {
  LIVE_ROUTE_DISPATCH_LOG,
  LIVE_ROUTE_UNAVAILABLE_LOG,
  configurePromptDispatchRouteResolver,
} from "@oh-my-opencode/utils/prompt-async-gate/route-resolver"

import {
  isPreSendConnectionFailure,
  markLiveRouteUnavailable,
  resolveDispatchClient,
  tryResolveDispatchClientSync,
} from "./live-server-route"
import { log } from "./logger"

configureSharedSubunitLogger(log)
configurePromptDispatchRouteResolver({
  tryResolveDispatchClientSync,
  resolveDispatchClient,
  isPreSendConnectionFailure,
  markLiveRouteUnavailable,
})

export {
  LIVE_ROUTE_DISPATCH_LOG,
  LIVE_ROUTE_UNAVAILABLE_LOG,
}
export * from "@oh-my-opencode/utils/prompt-async-gate"
