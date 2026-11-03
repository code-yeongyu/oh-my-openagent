import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { readDisabledSkills, readDiscoverCwd } from "./contributed-skill"
import { type BundledSkillsOverrideLogger, type NoticeUi, resolveBundledSkillsOverride } from "./override"

export { type BundledSkillsOverrideLogger, resolveBundledSkillsOverride } from "./override"

export const BUNDLED_SKILLS_COMPONENT_NAME = "bundled-skills"

export interface BundledSkillsComponentOptions {
  readonly env?: Record<string, string | undefined>
  /** Overrides the packaged skills root; tests point it at a fixture. */
  readonly skillsDir?: string
}

export interface BundledSkillsDirOptions {
  readonly logger?: BundledSkillsOverrideLogger
}

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
