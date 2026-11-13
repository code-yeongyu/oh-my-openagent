import type { RpcChildHandle, RpcRunnerSpec } from "../../types"
import type { HostSessionCloseChannel } from "../close"
import { HostSessionClient } from "../session-client"
import { probeFakeHost } from "./fake-host-probe"

/**
 * The two seams a parent session injects around the fake daemon: the channel the single close
 * writer attaches through, and the per-child runner the daemon path may fall back to.
 */

/** The real `closeHostSession` over the fixture's probe - a fake daemon, omo's own close path. */
export function fakeCloseChannel(socket: string): HostSessionCloseChannel {
  const client = new HostSessionClient({
    socketPath: socket,
    ports: { probeProtocolInfo: () => probeFakeHost(socket) },
  })
  return {
    open: (request) =>
      client.open({ ...request, kind: "worker", context: {}, retainOnDisconnect: false, autoTitle: false }),
    send: (command) => client.send(command),
    close: () => client.close(),
    detach: () => client.detach(),
  }
}

export interface FakeFallbackRunner {
  readonly starts: RpcRunnerSpec[]
  start(spec: RpcRunnerSpec): Promise<RpcChildHandle>
}

/** One identifiable child-process handle per child, plus the specs the runner was handed. */
export function fakeFallbackRunner(): FakeFallbackRunner {
  const starts: RpcRunnerSpec[] = []
  return {
    starts,
    start: (spec) => {
      starts.push(spec)
      return Promise.resolve({
        task_id: spec.task_id,
        sessionId: `fallback-${spec.task_id}`,
        pid: 30_000 + starts.length,
        steer: () => Promise.resolve(),
        followUp: () => Promise.resolve(),
        abort: () => Promise.resolve(),
        subscribe: () => () => undefined,
        waitForIdle: () => new Promise<void>(() => undefined),
        lastAssistantText: () => undefined,
        dispose: () => Promise.resolve(),
        terminate: () => Promise.resolve(),
        exitOutcome: () => undefined,
        waitForExit: () => new Promise(() => undefined),
        lastSeen: () => undefined,
      })
    },
  }
}
