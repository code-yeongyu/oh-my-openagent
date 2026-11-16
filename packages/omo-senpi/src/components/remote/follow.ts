import { type ClientCore, notYet, type RemoteClient } from "./client"
import type { FollowEvent, RemoteStream } from "./types"

type StreamMembers = Pick<RemoteClient["sessions"], "follow" | "wait">

/** A stream that delivers one `failed` event and ends. */
function failedStream(member: string): RemoteStream<FollowEvent> {
  let stopped = false
  return {
    stop: () => {
      stopped = true
    },
    async *[Symbol.asyncIterator]() {
      if (!stopped) yield { kind: "failed", failure: notYet(member) }
    },
  }
}

/**
 * The stream members of part 4a-2 (unit U2 of #13414): follow (status changes, turn ends, the turn's stream) and wait,
 * both on the attach pool's watch. Each answers `unsupported` until U2 lands.
 */
export function streamMembers(_core: ClientCore): StreamMembers {
  return {
    follow: () => failedStream("sessions.follow"),
    wait: async () => notYet("sessions.wait"),
  }
}
