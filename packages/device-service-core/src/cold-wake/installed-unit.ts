// What an installed session host unit runs and for whom: its program and the environment it was written with, read back
// from the text `systemdSessionHostUnit` / `launchdSessionHostPlist` render (omo#14191). A refresh carries the agent dir and
// PATH over from here, never from the process that happens to launch.

export type InstalledSessionHostUnit = {
  readonly program: string
  readonly env: ReadonlyMap<string, string>
}

// The inverse of `systemdQuote`: `\\` and `\"` are C escapes, `%%` and `$$` undo the specifier doubling.
const systemdUnquote = (quoted: string): string =>
  quoted.replace(/\\(.)|%%|\$\$/g, (match, escaped: string | undefined) => escaped ?? match.slice(1))

const SYSTEMD_QUOTED = /"((?:[^"\\]|\\.)*)"/g

function readSystemd(text: string): InstalledSessionHostUnit | undefined {
  const execStart = /^ExecStart=(.*)$/m.exec(text)?.[1]
  const program = execStart === undefined ? undefined : SYSTEMD_QUOTED.exec(execStart)?.[1]
  SYSTEMD_QUOTED.lastIndex = 0
  if (program === undefined) return undefined
  const env = new Map<string, string>()
  for (const [, quoted] of text.matchAll(/^Environment="((?:[^"\\]|\\.)*)"$/gm)) {
    const assignment = systemdUnquote(quoted ?? "")
    const equals = assignment.indexOf("=")
    if (equals > 0) env.set(assignment.slice(0, equals), assignment.slice(equals + 1))
  }
  return { program: systemdUnquote(program), env }
}

const xmlUnescape = (value: string): string =>
  value.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&amp;", "&")

function readLaunchd(text: string): InstalledSessionHostUnit | undefined {
  const argv = /<key>ProgramArguments<\/key>\s*<array>\s*<string>([^<]*)<\/string>/.exec(text)?.[1]
  if (argv === undefined) return undefined
  const env = new Map<string, string>()
  const dict = /<key>EnvironmentVariables<\/key>\s*<dict>([\s\S]*?)<\/dict>/.exec(text)?.[1] ?? ""
  for (const [, key, value] of dict.matchAll(/<key>([^<]*)<\/key>\s*<string>([^<]*)<\/string>/g))
    env.set(xmlUnescape(key ?? ""), xmlUnescape(value ?? ""))
  return { program: xmlUnescape(argv), env }
}

export const readInstalledSessionHostUnit = (text: string, darwin: boolean): InstalledSessionHostUnit | undefined =>
  darwin ? readLaunchd(text) : readSystemd(text)
