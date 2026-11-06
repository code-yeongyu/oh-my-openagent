import { accessSync, readdirSync } from "node:fs"
import { isAbsolute } from "node:path"

// A leaf module (node builtins only), so the telemetry helper `getBuiltinSkillsRoot` and the init-deep advisor bundle can
// share this one resolver without pulling the bundled-skills component's config loading into their bundles.

export interface BundledSkillsOverrideLogger {
  error(message: string): void
}

export type NoticeUi = { readonly notify?: (message: string, type: "error") => void }

/**
 * A valid OMO_BUNDLED_SKILLS_DIR (an absolute, readable, listable directory), or undefined when it
 * is absent, empty or invalid. Every bundled-skill consumer calls this, so an invalid value is
 * logged once per process and shown once through `ui` when given; the callers then fall back to the
 * plugin's own skills. The ledger lives on globalThis because omo.js, omo-task.js and
 * omo-init-deep-advisor.js each bundle this module.
 */
export function resolveBundledSkillsOverride(
  env: Record<string, string | undefined>,
  logger: BundledSkillsOverrideLogger = console,
  ui?: NoticeUi,
): string | undefined {
  const value = env["OMO_BUNDLED_SKILLS_DIR"]
  if (!value) return undefined
  let problem: string | undefined = "relative"
  if (isAbsolute(value)) {
    try {
      accessSync(value, 5) // R_OK | X_OK
      readdirSync(value) // ENOTDIR for a file
      return value
    } catch (error) {
      problem = (error as NodeJS.ErrnoException).code
    }
  }
  const message = `OMO_BUNDLED_SKILLS_DIR=${value} ignored (${problem}); needs a readable absolute dir`
  const seen = ((globalThis as Record<symbol, unknown>)[Symbol.for("omo.skillsDir")] ??= new Set<string>()) as Set<string>
  const once = (key: string) => seen.size < seen.add(key + message).size
  if (once("log")) logger.error(message)
  if (ui?.notify && once("ui")) ui.notify(message, "error")
  return undefined
}
