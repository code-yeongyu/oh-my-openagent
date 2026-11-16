import { packageName as sdkPackageName } from "@oh-my-opencode/omo-computer-sdk"
import { packageName as enginePackageName } from "@oh-my-opencode/omo-computer-engine"

/** Hand host parts of computer-use v3 in the spawning and attach-only profiles. */
export const packageName = "@oh-my-opencode/omo-computer-hand" as const

/** The packages this one depends on, exactly the edges of the architecture table. */
export const dependencyPackageNames = [sdkPackageName, enginePackageName] as const

export { resolveHandPaths, type HandPaths, type HostAddress } from "./paths.ts"
export { effectiveLatch, LatchStore, readHostLatch, writeHostLatch, type HostLatch } from "./host-latch.ts"
export { createSessionLocks } from "./session-locks.ts"
export { realScheduler, type Scheduler } from "./scheduler.ts"
export { startHeartbeat } from "./heartbeat.ts"
export { startWatchdog } from "./watchdog.ts"
export type { RpcReply } from "./rpc.ts"
export { connectDaemon, type DaemonLink } from "./daemon-link.ts"
export { DaemonLauncher, type DaemonChild } from "./launcher.ts"
export { createHandEnsure, type EnsureCaller, type EnsureReply } from "./ensure.ts"
export { createAttachOnlyHost } from "./attach-only.ts"
export { callHostApi, serveHostApi } from "./host-api.ts"
export { classifyOrigin, handResume, type OriginFacts } from "./resume.ts"
