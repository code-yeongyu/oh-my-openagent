import { spawn } from "bun"
import {
  createReplyListenerDaemonEnv,
  REPLY_LISTENER_DAEMON_IDENTITY_MARKER,
} from "./reply-listener-process"
import { REPLY_LISTENER_STARTUP_TOKEN_ENV } from "./reply-listener-state"

export interface ReplyListenerSpawnProcess {
  pid: number | undefined
  unref(): void
}

export function spawnReplyListenerDaemon(
  daemonScript: string,
  startupToken: string,
): ReplyListenerSpawnProcess {
  return spawn(["bun", "run", daemonScript, REPLY_LISTENER_DAEMON_IDENTITY_MARKER], {
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
    cwd: process.cwd(),
    env: createReplyListenerDaemonEnv({
      [REPLY_LISTENER_STARTUP_TOKEN_ENV]: startupToken,
    }),
  })
}
