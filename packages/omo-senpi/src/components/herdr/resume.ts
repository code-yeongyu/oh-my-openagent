/**
 * Resume-command construction for `resume_argv` (Herdr restart restore) and the pane-facing agent
 * label. Constraints per https://herdr.dev/docs/add-herdr-support/: the first element is a plain
 * command name on PATH, no apostrophes or control characters, at most 64 arguments and 8 KiB total.
 */

const RESUME_ARGV_MAX_ARGS = 64
const RESUME_ARGV_MAX_BYTES = 8 * 1024
const RESUME_ARG_REJECT = /['\x00-\x1f\x7f]/

export function isValidResumeArg(arg: string): boolean {
  return arg.length > 0 && !RESUME_ARG_REJECT.test(arg)
}

/** The product-facing agent label and resume binary: `omo` under the omo-ai launcher (`OMO_NATIVE=1`), `senpi` when the same plugin runs under a bare senpi install. */
export function resolveHerdrAgentName(env: NodeJS.ProcessEnv): string {
  return env.OMO_NATIVE === "1" ? "omo" : "senpi"
}

export interface HerdrResumeModel {
  readonly provider?: string
  readonly id?: string
}

export function buildResumeArgv(
  command: string,
  sessionId: string,
  model?: HerdrResumeModel,
  thinkingLevel?: string,
): readonly string[] | undefined {
  if (!isValidResumeArg(command) || !isValidResumeArg(sessionId)) return undefined

  const argv = [command, "--session", sessionId]
  if (model !== undefined && typeof model.id === "string" && model.id.length > 0) {
    const selector =
      typeof model.provider === "string" && model.provider.length > 0 ? `${model.provider}/${model.id}` : model.id
    const thinking =
      typeof thinkingLevel === "string" && thinkingLevel.length > 0 && thinkingLevel !== "off"
        ? `:${thinkingLevel}`
        : ""
    const modelArg = `${selector}${thinking}`
    if (isValidResumeArg(modelArg)) argv.push("--model", modelArg)
  }

  if (argv.length > RESUME_ARGV_MAX_ARGS) return undefined
  if (argv.reduce((total, arg) => total + arg.length, 0) > RESUME_ARGV_MAX_BYTES) return undefined
  return argv
}
