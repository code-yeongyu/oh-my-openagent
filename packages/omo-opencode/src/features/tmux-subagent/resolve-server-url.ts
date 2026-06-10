type ServerUrlEnv = Record<string, string | undefined>

export function resolveServerUrl(
  rawServerUrl: string | undefined,
  env: ServerUrlEnv,
  log: (message: string, data?: unknown) => void,
): string {
  const configuredPort = env.OPENCODE_PORT
  const parsedPort = configuredPort ? Number(configuredPort) : 4096
  const defaultPort = Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535
    ? String(parsedPort)
    : "4096"
  const fallbackUrl = `http://localhost:${defaultPort}`

  try {
    if (rawServerUrl) {
      const parsed = new URL(rawServerUrl)
      const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80')
      if (port === '0') {
        log(
          "[tmux-session-manager] ctx.serverUrl has port 0; falling back. " +
            "team_mode tmux visualization will silently skip if nothing is listening on the fallback URL. " +
            "Launch opencode with --port N and OPENCODE_PORT=N to bind a real port (see issue #3963).",
          { kind: "warning", ctxServerUrl: rawServerUrl, fallbackUrl },
        )
        return fallbackUrl
      }
      return rawServerUrl
    }
    return fallbackUrl
  } catch (error) {
    log("[tmux-session-manager] failed to parse server URL, using fallback", {
      serverUrl: rawServerUrl,
      error: String(error),
    })
    return fallbackUrl
  }
}
