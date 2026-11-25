import type { Static } from "typebox"

import { streamCall, threadCall, valueCall } from "../call-spec"
import * as custody from "../inputs/custody"
import * as launch from "../inputs/launch"
import * as loop from "../inputs/loop"
import * as threads from "../inputs/threads-authority"
import type * as result from "../results/authority"
import type * as held from "../results/custody"

// The rows slice P1a held for P1a-s (security design #14945): the credential-bearing calls, the launch operations, attach,
// the extension session operations, the OpenCode edition's run and the loop's operations. A call here is a type, never
// authority: the principal matrix says who may make it, and P1b enforces it in the core.
type Answer<Schema extends keyof typeof held.CUSTODY_RESULTS> = Static<(typeof held.CUSTODY_RESULTS)[Schema]>

export const AUTHORITY_CALLS = {
  "account.signIn": valueCall<Answer<"account.signIn">>()(custody.AccountSignIn),
  "account.adopt": valueCall<Answer<"account.adopt">>()(custody.AccountAdopt),
  "account.credentials.handOver": valueCall<Answer<"account.credentials.handOver">>()(
    custody.AccountCredentialsHandOver,
  ),
  "account.keys.init": valueCall<Answer<"account.keys.init">>()(custody.AccountKeysInit),
  "account.keys.status": valueCall<Answer<"account.keys.status">>()(custody.AccountKeysStatus),
  "sync.enable": valueCall<Answer<"sync.enable">>()(custody.SyncEnable),
  "sync.recover": valueCall<Answer<"sync.recover">>()(custody.SyncRecover),
  "engine.auth.check": valueCall<Answer<"engine.auth.check">>()(custody.EngineAuthCheck),
  "engine.auth.credentials": valueCall<Answer<"engine.auth.credentials">>()(custody.EngineAuthCredentials),
  "engine.auth.apiKey": valueCall<Answer<"engine.auth.apiKey">>()(custody.EngineAuthApiKey),
  "engine.auth.bearerToken": valueCall<Answer<"engine.auth.bearerToken">>()(custody.EngineAuthBearerToken),
  "engine.trust.ensure": valueCall<Answer<"engine.trust.ensure">>()(custody.EngineTrustEnsure),
  "engine.launch.interactive": valueCall<result.Launched>()(launch.EngineLaunchInteractive),
  "engine.launch.print": streamCall<result.PrintEvent, result.Launched>()(launch.EngineLaunchPrint),
  "engine.launch.rpc": valueCall<result.RpcServing>()(launch.EngineLaunchRpc),
  "engine.launch.hand": valueCall<result.HostServing>()(launch.EngineLaunchHand),
  "engine.launch.headless": valueCall<result.HostServing>()(launch.EngineLaunchHeadless),
  "mcp.oauth.login": valueCall<Answer<"mcp.oauth.login">>()(custody.McpOauthLogin),
  "mcp.oauth.logout": valueCall<Answer<"mcp.oauth.logout">>()(custody.McpOauthLogout),
  "mcp.oauth.status": valueCall<Answer<"mcp.oauth.status">>()(custody.McpOauthStatus),
  "threads.attach": threadCall<{ readonly kind: "ok"; readonly attach: result.Attached }>()(threads.ThreadsAttach),
  "threads.extensions.sessionOps": valueCall<result.SessionOps>()(threads.ThreadsExtensionsSessionOps),
  "threads.extensions.sessionCall": valueCall<unknown>()(threads.ThreadsExtensionsSessionCall),
  "threads.runToCompletion": streamCall<result.RunEvent, result.RunCompleted>()(threads.ThreadsRunToCompletion),
  "toolkit.forSession": valueCall<result.LoopBinding>()(loop.ToolkitForSession),
  "toolkit.addGoal": valueCall<result.LoopAnswer>()(loop.ToolkitAddGoal),
  "toolkit.checkpoint": valueCall<result.LoopAnswer>()(loop.ToolkitCheckpoint),
  "toolkit.completeGoals": valueCall<result.LoopAnswer>()(loop.ToolkitCompleteGoals),
  "toolkit.createGoals": valueCall<result.LoopAnswer>()(loop.ToolkitCreateGoals),
  "toolkit.criteria": valueCall<result.LoopAnswer>()(loop.ToolkitCriteria),
  "toolkit.recordEvidence": valueCall<result.LoopAnswer>()(loop.ToolkitRecordEvidence),
  "toolkit.recordReviewBlockers": valueCall<result.LoopAnswer>()(loop.ToolkitRecordReviewBlockers),
  "toolkit.status": valueCall<result.LoopAnswer>()(loop.ToolkitStatus),
  "toolkit.steer": valueCall<result.LoopAnswer>()(loop.ToolkitSteer),
} as const
