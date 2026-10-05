import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { readDisabledSkills, readDiscoverCwd } from "./contributed-skill"

export const BUNDLED_SKILLS_COMPONENT_NAME = "bundled-skills"

export interface BundledSkillsComponentOptions {
  readonly env?: Record<string, string | undefined>
  /** Overrides the packaged skills root; tests point it at a fixture. */
  readonly skillsDir?: string
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
      pi.on("resources_discover", (payload: unknown) => {
        const skillsDir = options.skillsDir ?? resolveBundledSkillsDir()
        if (skillsDir === undefined) return undefined
        const disabled = readDisabledSkills(readDiscoverCwd(payload) ?? pi.cwd ?? process.cwd(), options.env ?? process.env)
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
 * Packaged plugin skills win; the source-tree copy keeps dev runs working. From the bundled
 * extension at plugin/extensions/omo.js the packaged URL resolves to plugin/skills; from this
 * source file it resolves to the same synced directory.
 */
export function resolveBundledSkillsDir(importerUrl: string = import.meta.url): string | undefined {
  const candidates = [
    fileURLToPath(new URL("../skills", importerUrl)),
    fileURLToPath(new URL("../../../plugin/skills", importerUrl)),
  ]
  return candidates.find((candidate) => existsSync(candidate))
}
