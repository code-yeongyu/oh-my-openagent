export type CmuxSplitDirection = "horizontal" | "vertical"

export function isInsideCmuxEnvironment(environment: Record<string, string | undefined>): boolean {
  return Boolean(environment.CMUX_SOCKET_PATH || environment.CMUX_SOCKET)
}

export function isInsideCmux(): boolean {
  return isInsideCmuxEnvironment(process.env)
}

export function getCmuxSocketPath(): string | undefined {
  return process.env.CMUX_SOCKET_PATH || process.env.CMUX_SOCKET
}

export function mapTmuxDirectionToCmux(direction: "-h" | "-v"): CmuxSplitDirection {
  return direction === "-h" ? "vertical" : "horizontal"
}

export function getCmuxContext(): { workspaceId?: string; surfaceId?: string } {
  return {
    workspaceId: process.env.CMUX_WORKSPACE_ID,
    surfaceId: process.env.CMUX_SURFACE_ID,
  }
}
