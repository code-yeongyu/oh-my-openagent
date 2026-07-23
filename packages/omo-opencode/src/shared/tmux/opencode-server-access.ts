import {
  createServerHealthState,
  isServerRunning,
  type TmuxPaneEnvironment,
  type TmuxServerAccess,
  type TmuxServerTarget,
} from "@oh-my-opencode/tmux-core"

import {
  getServerBasicAuthHeader,
  resolveOpenCodeServerCredentials,
  type OpenCodeServerAuthEnvironment,
} from "../opencode-server-auth"

export type OpenCodeServerTargetSource =
  | "current-context"
  | "explicit-port"
  | "synthetic-fallback"
  | "raw-or-historical"

export type ResolvedOpenCodeServerTarget =
  | {
    readonly serverUrl: string
    readonly source: Extract<OpenCodeServerTargetSource, "current-context" | "explicit-port">
    readonly trusted: true
  }
  | {
    readonly serverUrl: string
    readonly source: Extract<OpenCodeServerTargetSource, "synthetic-fallback" | "raw-or-historical">
    readonly trusted: false
  }

export type OpenCodeTmuxServerAccessOptions = {
  readonly fetchImplementation?: typeof fetch
  readonly getEnvironment?: () => OpenCodeServerAuthEnvironment
}

const CLEARED_OPENCODE_PANE_ENVIRONMENT: TmuxPaneEnvironment = Object.freeze({
  OPENCODE_SERVER_PASSWORD: "",
  OPENCODE_SERVER_USERNAME: "",
})

function getTrustedPaneEnvironment(
  environment: OpenCodeServerAuthEnvironment,
): TmuxPaneEnvironment {
  const credentials = resolveOpenCodeServerCredentials(environment)
  if (!credentials) {
    return CLEARED_OPENCODE_PANE_ENVIRONMENT
  }

  return {
    OPENCODE_SERVER_PASSWORD: credentials.password,
    OPENCODE_SERVER_USERNAME: credentials.username,
  }
}

export function createOpenCodeTmuxServerAccess(
  target: ResolvedOpenCodeServerTarget,
  options: OpenCodeTmuxServerAccessOptions = {},
): TmuxServerAccess {
  const state = createServerHealthState()
  const getEnvironment = options.getEnvironment ?? (() => process.env)

  return {
    serverUrl: target.serverUrl,
    checkServerHealth: () => {
      const authorization = target.trusted
        ? getServerBasicAuthHeader(getEnvironment())
        : undefined
      return isServerRunning(target.serverUrl, {
        headers: authorization ? { Authorization: authorization } : undefined,
        redirect: "error",
        fetchImplementation: options.fetchImplementation,
        state,
      })
    },
    getPaneEnvironment: () => target.trusted
      ? getTrustedPaneEnvironment(getEnvironment())
      : CLEARED_OPENCODE_PANE_ENVIRONMENT,
  }
}

export function createAnonymousOpenCodeTmuxServerAccess(
  serverUrl: string,
  options: OpenCodeTmuxServerAccessOptions = {},
): TmuxServerAccess {
  return createOpenCodeTmuxServerAccess({
    serverUrl,
    source: "raw-or-historical",
    trusted: false,
  }, options)
}

export function normalizeOpenCodeTmuxServerTarget(target: TmuxServerTarget): TmuxServerAccess {
  return typeof target === "string"
    ? createAnonymousOpenCodeTmuxServerAccess(target)
    : target
}
