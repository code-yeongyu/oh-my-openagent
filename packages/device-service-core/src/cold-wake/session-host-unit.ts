import { isAbsolute } from "node:path"

// omo#13594: the ONE cold-wake unit. The device service starts it only by the fixed name its launch-time table carries
// (OMO_RELAYD_SERVICES entry "omo"), and it runs exactly `<omo> daemon run` for the agent dir the bootstrap registered,
// so neither the name nor the command is something a caller can configure.
export const SESSION_HOST_SYSTEMD_UNIT = "omo-session-host.service"
export const SESSION_HOST_LAUNCHD_LABEL = "ai.omo.session-host"

export class ColdWakeUnitError extends Error {}

const hasControlCharacter = (value: string): boolean =>
  [...value].some((char) => {
    const code = char.charCodeAt(0)
    return code < 0x20 || code === 0x7f
  })

// A control character (a newline above all) would end the quoted value and start a unit line of its own.
const checked = (name: string, value: string, absolute: boolean): string => {
  if (value === "" || hasControlCharacter(value)) throw new ColdWakeUnitError(`the ${name} has a control character`)
  if (absolute && !isAbsolute(value)) throw new ColdWakeUnitError(`the ${name} is not an absolute path`)
  return value
}

/** The checked start of the session host: the argv and environment both unit renderers write. */
export class SessionHostLaunch {
  private readonly checked = true
  readonly argv: readonly string[]
  readonly env: readonly (readonly [string, string])[]

  private constructor(argv: readonly string[], env: readonly (readonly [string, string])[]) {
    this.argv = argv
    this.env = env
  }

  /** An npm launcher script (`bin/omo.js`) runs under the runtime that ran it; a compiled omo runs directly. */
  static from(options: {
    readonly omoBin: string
    readonly execPath: string
    readonly agentDir: string
    readonly path?: string | undefined
  }): SessionHostLaunch {
    const program = checked("omo binary", options.omoBin, true)
    const argv = program.endsWith(".js")
      ? [checked("runtime", options.execPath, true), program, "daemon", "run"]
      : [program, "daemon", "run"]
    const env: (readonly [string, string])[] = [["OMO_CODING_AGENT_DIR", checked("agent dir", options.agentDir, true)]]
    if (options.path !== undefined && options.path !== "") env.push(["PATH", checked("PATH", options.path, false)])
    return new SessionHostLaunch(argv, env)
  }
}

// systemd expands %-specifiers in ExecStart= and Environment=, and $VAR in ExecStart=, even inside quotes: double them.
export const systemdQuote = (value: string, dollars: boolean): string => {
  const escaped = value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%")
  return `"${dollars ? escaped.replaceAll("$", () => "$$") : escaped}"`
}

/**
 * A oneshot: every start runs the ensure again (reusing a live host), and `KillMode=process` leaves the host it detached
 * running when the oneshot ends. No [Install] section: nothing starts it but a cold wake.
 */
export const systemdSessionHostUnit = (launch: SessionHostLaunch): string =>
  [
    "[Unit]",
    "Description=OmO session host (cold wake)",
    "",
    "[Service]",
    "Type=oneshot",
    `ExecStart=${launch.argv.map((arg) => systemdQuote(arg, true)).join(" ")}`,
    ...launch.env.map(([key, value]) => `Environment=${systemdQuote(`${key}=${value}`, false)}`),
    "KillMode=process",
    "TimeoutStartSec=120",
    "",
  ].join("\n")

const xml = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")

/**
 * Loaded but idle: `launchctl kickstart` starts it, it never runs at load and is never kept alive, and
 * `AbandonProcessGroup` keeps launchd from ending the host the ensure detached when the job exits.
 */
export const launchdSessionHostPlist = (launch: SessionHostLaunch): string => {
  const argv = launch.argv.map((arg) => `    <string>${xml(arg)}</string>`).join("\n")
  const env = launch.env
    .map(([key, value]) => `    <key>${xml(key)}</key>\n    <string>${xml(value)}</string>`)
    .join("\n")
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SESSION_HOST_LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${argv}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${env}
  </dict>
  <key>RunAtLoad</key>
  <false/>
  <key>KeepAlive</key>
  <false/>
  <key>AbandonProcessGroup</key>
  <true/>
  <key>ProcessType</key>
  <string>Interactive</string>
</dict>
</plist>
`
}
