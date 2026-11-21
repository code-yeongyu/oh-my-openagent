import { accessSync, existsSync, readdirSync } from "node:fs"
import { isAbsolute, join } from "node:path"
import { fileURLToPath } from "node:url"

import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { readDisabledSkills, readDiscoverCwd } from "./contributed-skill"

export const BUNDLED_SKILLS_COMPONENT_NAME = "bundled-skills"

export interface BundledSkillsComponentOptions {
  readonly env?: Record<string, string | undefined>
  /** Overrides the packaged skills root; tests point it at a fixture. */
  readonly skillsDir?: string
}

export interface BundledSkillsOverrideLogger {
  error(message: string): void
}

export interface BundledSkillsDirOptions {
  readonly logger?: BundledSkillsOverrideLogger
}

type NoticeUi = { readonly notify?: (message: string, type: "error") => void }

/**
 * Contributes the plugin's bundled skills through `resources_discover`, minus `disabled_skills`.
 *
 * The plugin manifest deliberately declares no `pi.skills`: the launcher always loads the plugin
 * with `--extension <plugin>`, and senpi applies no user-level filter to a command-line package's
 * manifest skills, so a manifest entry would put every bundled skill into every run regardless of
 * config. Contributing them here lets `disabled_skills` in `~/.omo/omo.jsonc` (user, project,
 * `[senpi]`, or profile - unioned) make a skill absent from the session: it never reaches the
 * `<available_skills>` index, the `/skill:` commands, or `get_commands`.
 *
 * The plugin is a system package, so paths inside its root keep the `system` scope senpi assigns
 * to the manifest entries this replaces. Config is re-read on every discover pass, so `/reload`
 * picks up an edited denylist.
 */
export function createBundledSkillsComponent(options: BundledSkillsComponentOptions = {}): OmoSenpiComponent {
  return {
    name: BUNDLED_SKILLS_COMPONENT_NAME,
    register(pi: SenpiExtensionAPI, ctx: ComponentContext): void {
      const env = options.env ?? process.env
      pi.on("session_start", (_payload: unknown, eventCtx: unknown) => {
        resolveBundledSkillsOverride(env, ctx.logger, (eventCtx as { readonly ui?: NoticeUi } | undefined)?.ui)
      })
      pi.on("resources_discover", (payload: unknown) => {
        const skillsDir = options.skillsDir ?? resolveBundledSkillsDir(undefined, env, ctx)
        if (skillsDir === undefined) return undefined
        const disabled = readDisabledSkills(readDiscoverCwd(payload) ?? pi.cwd ?? process.cwd(), env)
        const skillPaths: string[] = []
        const hidden: string[] = []
        for (const name of readdirSync(skillsDir).sort()) {
          const skillFile = join(skillsDir, name, "SKILL.md")
          if (!existsSync(skillFile)) continue
          if (disabled.has(name)) {
            hidden.push(name)
            continue
          }
          skillPaths.push(skillFile)
        }
        if (hidden.length > 0) {
          ctx.logger.debug?.("bundled skills hidden by disabled_skills", { component: BUNDLED_SKILLS_COMPONENT_NAME, hidden })
        }
        return { skillPaths }
      })
    },
  }
}

/**
 * A valid OMO_BUNDLED_SKILLS_DIR wins (callers put an explicit `skillsDir` ahead of this); otherwise
 * the packaged plugin skills, then the source-tree copy that keeps dev runs working. From the bundled extension at plugin/extensions/omo.js the
 * packaged URL resolves to plugin/skills; from this source file it resolves to the same synced
 * directory. An invalid override is reported once and falls back to these packaged roots.
 */
export function resolveBundledSkillsDir(
  importerUrl: string = import.meta.url,
  env: Record<string, string | undefined> = process.env,
  options: BundledSkillsDirOptions = {},
): string | undefined {
  return resolveBundledSkillsOverride(env, options.logger) ?? [
    fileURLToPath(new URL("../skills", importerUrl)),
    fileURLToPath(new URL("../../../plugin/skills", importerUrl)),
  ].find((candidate) => existsSync(candidate))
}

/**
 * A valid OMO_BUNDLED_SKILLS_DIR (an absolute, readable, listable directory), or undefined when it
 * is absent, empty or invalid. Every bundled-skill consumer calls this, so an invalid value is
 * logged once per process and shown once through `ui` when given; the callers then fall back to the
 * plugin's own skills. The ledger lives on globalThis because omo.js and omo-task.js each bundle
 * this module.
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
