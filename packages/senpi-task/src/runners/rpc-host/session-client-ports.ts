import { socketAcceptsConnection } from "./busy-host"
import type { PermissionPushPorts } from "./permission-push"
import type { HostSessionClientOptions } from "./session-client-contract"
import { createSenpiRpcClient, probeWithEngine } from "./session-transport"

/** The engine-backed ports of one child's host connection, each replaceable by a suite; the probe names the key root. */
export function hostClientPorts(options: HostSessionClientOptions): PermissionPushPorts {
  const { keyRoot } = options
  return {
    socketPath: options.socketPath,
    ...(keyRoot === undefined ? {} : { keyRoot }),
    createClient: options.ports?.createClient ?? createSenpiRpcClient,
    probeProtocolInfo: options.ports?.probeProtocolInfo ?? ((socket) => probeWithEngine(socket, keyRoot)),
    socketAccepts: options.ports?.socketAccepts ?? socketAcceptsConnection,
  }
}
