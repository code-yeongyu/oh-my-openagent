import { AgentSession, type Json, type ToolOutcome } from "./agent"
import { type KeySink, settle } from "./fixtures"
import { postKeystroke } from "./observer"

export const SCENARIOS = [
  "preflight",
  "background-click-keeps-focus",
  "background-type-sole-window",
  "background-type-multiwindow-refused",
  "foreground-restores",
  "killswitch-real-hid",
  "tcc-diagnostic",
  "screenshot-budget",
  "capabilities-truth",
  "canary",
  "canary-off",
] as const

export type ScenarioName = (typeof SCENARIOS)[number]
export const isScenarioName = (value: string): value is ScenarioName => SCENARIOS.some((name) => name === value)
export interface ScenarioResult {
  readonly scenario: ScenarioName
  readonly pass: boolean
  readonly facts: Json
}
export interface RunOptions {
  readonly senpiBin: string
  readonly enginePath: string | undefined
  readonly forceForeground: boolean
  readonly jetkvm: string | undefined
  readonly kvmShots: string | undefined
}

export async function withSession<T>(
  options: RunOptions, computer: Json, use: (session: AgentSession) => Promise<T>,
): Promise<T> {
  const session = new AgentSession(computer, options.senpiBin, options.enginePath)
  try {
    await session.command("on")
    return await use(session)
  } finally {
    await session.close()
  }
}

export function onWindow(title: string, body: string): Json {
  return {
    action: "run",
    code: [
      `const w = await desktop.window({ app: "TextEdit", title: ${JSON.stringify(title)} });`,
      "const s = await w.screenshot({ silent: true });",
      body,
    ].join("\n"),
    timeout: 300,
  }
}

export const warmUp = (session: AgentSession, title: string): Promise<ToolOutcome> =>
  session.call(onWindow(title, 'await w.move(Math.round(s.width / 2), Math.round(s.height / 2)); return "warm";'))

export const clickCode = (title: string, delivery: string): Json =>
  onWindow(title, `await w.click(Math.round(s.width / 2), Math.round(s.height * 0.8), { delivery: ${JSON.stringify(delivery)} }); return "clicked";`)

export const toolError = (result: ToolOutcome): string | null => result.isError ? result.text : null

export async function keyLands(sink: KeySink): Promise<{ readonly token: string; readonly landed: boolean }> {
  const token = String(Date.now()).slice(-6)
  await postKeystroke(token)
  const landed = await settle("keystroke in key sink", async () => sink.read(), (text) => text.includes(token),
    undefined, sink.path)
    .then(() => true)
    .catch(() => false)
  return { token, landed }
}
