import { startFakeHost, type FakeHost, type FakeHostOptions } from "./__fixtures__/fake-host"
import { HostSessionClient, type HostSessionOpenInput } from "./session-client"

/** The child launch profile every session-client suite opens with. */
export const CHILD_CONTEXT = { role: "child", task_id: "t-28" } as const

export function childOpenInput(sessionPath: string): HostSessionOpenInput {
  return {
    sessionPath,
    cwd: "/tmp/child-cwd",
    provider: "anthropic",
    modelId: "claude-sonnet-4-5",
    thinkingLevel: "medium",
    kind: "worker",
    context: CHILD_CONTEXT,
    retainOnDisconnect: true,
    autoTitle: false,
  }
}

export interface SessionClientHarness {
  fakeHost(options?: FakeHostOptions): Promise<FakeHost>
  hostClient(host: FakeHost): HostSessionClient
  release(): Promise<void>
}

/**
 * Per-suite registry of fake hosts and clients: `release` detaches every client and stops every
 * host (each host owns its own mkdtemp socket dir), so two suites - or two checkouts running
 * concurrently - never share a path or leak a listener.
 */
export function sessionClientHarness(): SessionClientHarness {
  const hosts: FakeHost[] = []
  const clients: HostSessionClient[] = []
  return {
    fakeHost: async (options) => {
      const host = await startFakeHost(options)
      hosts.push(host)
      return host
    },
    hostClient: (host) => {
      const client = new HostSessionClient({
        socketPath: host.socketPath,
        ports: { probeProtocolInfo: () => host.probeProtocolInfo() },
      })
      clients.push(client)
      return client
    },
    release: async () => {
      for (const client of clients.splice(0)) await client.detach()
      for (const host of hosts.splice(0)) await host.stop()
    },
  }
}
