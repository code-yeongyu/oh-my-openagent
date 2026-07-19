import { getHttpServerOriginForLog } from "@oh-my-opencode/tmux-core"
import type { ResolvedOpenCodeServerTarget } from "../../shared/tmux/opencode-server-access"

type ServerUrlEnv = Record<string, string | undefined>

const CANONICAL_SDK_FALLBACK_URL = "http://localhost:4096"

function resolveExplicitPort(value: string | undefined): number | null {
  if (!value || !/^[1-9]\d{0,4}$/.test(value)) {
    return null
  }

  const port = Number(value)
  return port <= 65535 ? port : null
}

function fallbackTarget(env: ServerUrlEnv): ResolvedOpenCodeServerTarget {
  const explicitPort = resolveExplicitPort(env.OPENCODE_PORT)
  if (explicitPort !== null) {
    return {
      serverUrl: `http://localhost:${explicitPort}`,
      source: "explicit-port",
      trusted: true,
    }
  }

  return {
    serverUrl: CANONICAL_SDK_FALLBACK_URL,
    source: "synthetic-fallback",
    trusted: false,
  }
}

export function resolveServerTarget(
  rawServerUrl: string | undefined,
  env: ServerUrlEnv,
  log: (message: string, data?: unknown) => void,
): ResolvedOpenCodeServerTarget {
  const fallback = fallbackTarget(env)

  if (!rawServerUrl) {
    return fallback
  }

  let parsed: URL
  try {
    parsed = new URL(rawServerUrl)
  } catch {
    log("[tmux-session-manager] failed to parse server URL, using fallback", {
      reason: "invalid-url",
      fallbackUrl: fallback.serverUrl,
    })
    return fallback
  }

  if (parsed.username || parsed.password) {
    log("[tmux-session-manager] rejected server URL with userinfo, using fallback", {
      reason: "userinfo-not-allowed",
      fallbackUrl: fallback.serverUrl,
    })
    return fallback
  }

  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.hostname) {
    log("[tmux-session-manager] rejected unsupported server URL, using fallback", {
      reason: "unsupported-url",
      fallbackUrl: fallback.serverUrl,
    })
    return fallback
  }

  if (parsed.port === "0") {
    log(
      "[tmux-session-manager] OpenCode reported a listener URL with port 0; falling back. " +
        "team_mode tmux visualization will silently skip if nothing is listening on the fallback URL. " +
        "Launch opencode with --port N and OPENCODE_PORT=N to bind a real port (see issue #3963).",
      {
        kind: "warning",
        ctxServerOrigin: getHttpServerOriginForLog(rawServerUrl),
        fallbackUrl: fallback.serverUrl,
      },
    )
    return fallback
  }

  if (parsed.origin === CANONICAL_SDK_FALLBACK_URL) {
    return fallback
  }

  return {
    serverUrl: parsed.toString(),
    source: "current-context",
    trusted: true,
  }
}

export function resolveServerUrl(
  rawServerUrl: string | undefined,
  env: ServerUrlEnv,
  log: (message: string, data?: unknown) => void,
): string {
  return resolveServerTarget(rawServerUrl, env, log).serverUrl
}
