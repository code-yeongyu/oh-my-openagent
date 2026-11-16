import { isAbsolute } from "node:path"

// omo#13594: the ONE session host unit, always on beside the device service and its only cold-wake unit: the device
// service starts it only by the fixed name its launch-time table carries (OMO_RELAYD_SERVICES entry "omo"), and it runs
// exactly `<omo> daemon run --pinned` for the agent dir the bootstrap registered, so neither the name nor the command is
// something a caller can configure. `--pinned`: the host it starts never idle-exits.
//
// `omo daemon run` ensures the host, which detaches, and exits. The service manager runs it again after every exit, at
// most once per RERUN_SECONDS, so a host that died is ensured again; one that runs is reused and never killed (systemd
// KillMode=process, launchd AbandonProcessGroup), so a restart or stop of the unit never ends a session.
const RERUN_SECONDS = 30
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
  /** The omo program: the binary, or the runtime and the launcher script. */
  private readonly program: readonly string[]
  readonly argv: readonly string[]
  readonly env: readonly (readonly [string, string])[]

  private constructor(program: readonly string[], env: readonly (readonly [string, string])[]) {
    this.program = program
    this.argv = [...program, "daemon", "run", "--pinned"]
    this.env = env
  }

  /** Another omo command for the same agent dir, run the way the unit runs it (through env, no shell). */
  omoCommand(args: readonly string[]): readonly string[] {
    return ["/usr/bin/env", ...this.env.map(([key, value]) => `${key}=${value}`), ...this.program, ...args]
  }

  /** An npm launcher script (`bin/omo.js`) runs under the runtime that ran it; a compiled omo runs directly. */
  static from(options: {
    readonly omoBin: string
    readonly execPath: string
    readonly agentDir: string
    readonly path?: string | undefined
  }): SessionHostLaunch {
    const program = checked("omo binary", options.omoBin, true)
    const omo = program.endsWith(".js") ? [checked("runtime", options.execPath, true), program] : [program]
    const env: (readonly [string, string])[] = [["OMO_CODING_AGENT_DIR", checked("agent dir", options.agentDir, true)]]
    if (options.path !== undefined && options.path !== "") env.push(["PATH", checked("PATH", options.path, false)])
    return new SessionHostLaunch(omo, env)
  }
}

// systemd expands %-specifiers in ExecStart= and Environment=, and $VAR in ExecStart=, even inside quotes: double them.
export const systemdQuote = (value: string, dollars: boolean): string => {
  const escaped = value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%")
  return `"${dollars ? escaped.replaceAll("$", () => "$$") : escaped}"`
}

/** Started with the user's manager (`default.target`); `StartLimitIntervalSec=0` lets the reruns go on forever. */
export const systemdSessionHostUnit = (launch: SessionHostLaunch): string =>
  [
    "[Unit]",
    "Description=OmO session host",
    "StartLimitIntervalSec=0",
    "",
    "[Service]",
    "Type=simple",
    `ExecStart=${launch.argv.map((arg) => systemdQuote(arg, true)).join(" ")}`,
    ...launch.env.map(([key, value]) => `Environment=${systemdQuote(`${key}=${value}`, false)}`),
    "Restart=always",
    `RestartSec=${RERUN_SECONDS}`,
    "KillMode=process",
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n")

const xml = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")

/** Runs at load and is kept alive; `ThrottleInterval` spaces the reruns. */
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
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>${RERUN_SECONDS}</integer>
  <key>AbandonProcessGroup</key>
  <true/>
  <key>ProcessType</key>
  <string>Interactive</string>
</dict>
</plist>
`
}
