import type { HostProtocolProbe, HostRpcClient, HostRpcClientFactory, HostSessionOpenInput } from "./session-transport"
import { openHostSessionConnection } from "./session-client-opening"

export interface PermissionPushPorts {
  readonly socketPath: string
  readonly createClient: HostRpcClientFactory
  readonly probeProtocolInfo: HostProtocolProbe
  readonly socketAccepts: (socketPath: string) => Promise<boolean>
}

/**
 * Moves a live task-host child to its parent's new approval mode (#6189 F2e). The engine's RPC client has no setter,
 * so a short side connection re-sends the child's own open with the new `permissionPreset`: an open naming a preset on
 * a held path attaches and applies it, and the side connection detaches again. The side open never retains anything,
 * so a child that is already gone is not reopened behind the parent's back; that case fails typed.
 */
export async function reapplyPermissionPreset(input: HostSessionOpenInput, ports: PermissionPushPorts): Promise<void> {
  let side: HostRpcClient | undefined
  try {
    const { opened } = await openHostSessionConnection({ ...input, retainOnDisconnect: false }, {
      ...ports,
      onDisconnect: () => {},
      onEvent: () => {},
      bindClient: (client) => { side = client },
    })
    if (opened.attached !== true) {
      await side?.closeSession(opened.sessionId)
      throw new Error("the child's session is no longer on its task host; its approval mode was not changed")
    }
  } finally {
    await side?.stop()
  }
}
