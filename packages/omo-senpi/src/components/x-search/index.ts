import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { fileURLToPath } from "node:url"

import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { resolveAgentHome } from "../agent-home/resolve-agent-home"
import { hasXaiCredential } from "./auth"
import type { XSearchFetch } from "./client"
import { createXSearchTool } from "./tool"

export { createXSearchTool, X_SEARCH_TOOL_NAME, X_SEARCH_TOOL_DESCRIPTION } from "./tool"

export const X_SEARCH_COMPONENT_NAME = "x-search"

export interface XSearchComponentOptions {
  /** Overrides agent-home resolution; tests point it at a temp dir holding auth.json. */
  readonly agentDir?: string
  readonly env?: Record<string, string | undefined>
  readonly homeDir?: string
  readonly fetchImpl?: XSearchFetch
  readonly resolveSkillPath?: () => string | undefined
}

/**
 * Credential-gated registration of the x_search tool and its conditional skill.
 *
 * Registration happens at EXTENSION LOAD, not on session_start: senpi runs builtin extensions
 * (including tool-search) before package extensions and ToolSearchService.beginSession() scans the
 * catalog at session_start, so a tool registered later would leave tool_search unaware of x_search
 * until the next catalog refresh. The gate is therefore a SYNCHRONOUS read of <agentDir>/auth.json;
 * the refresh-aware per-call bearer still resolves through ctx.modelRegistry inside execute().
 */
export function createXSearchComponent(options: XSearchComponentOptions = {}): OmoSenpiComponent {
  const env = options.env ?? process.env
  const resolveSkill = options.resolveSkillPath ?? (() => resolveXSearchSkillPath())

  return {
    name: X_SEARCH_COMPONENT_NAME,
    register(pi: SenpiExtensionAPI, ctx: ComponentContext): void {
      const agentDir = options.agentDir ?? resolveAgentHome({ env, homeDir: options.homeDir ?? homedir() })
      const connected = hasXaiCredential({ agentDir, env })
      // Both outcomes are expected states: the default logger prints info to the terminal before the
      // TUI takes over, so they stay on the optional debug channel instead of greeting every startup.
      if (!connected) {
        ctx.logger.debug?.("x-search skipped: no xAI credential", { component: X_SEARCH_COMPONENT_NAME })
        return
      }

      pi.registerTool({
        ...createXSearchTool({ env, ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }) }),
      })
      ctx.logger.debug?.("x-search registered", { component: X_SEARCH_COMPONENT_NAME })

      // The skill is contributed only when the credential exists, so a machine without xAI never
      // pays for the conditional skill's description in the skills index. A payload that lost the
      // staged copy keeps the tool but never advertises a path senpi would flag as missing.
      const skillPath = resolveSkill()
      if (skillPath === undefined) {
        ctx.logger.warn("x-search skill missing: x_search registered without its conditional skill", {
          component: X_SEARCH_COMPONENT_NAME,
        })
        return
      }
      pi.on("resources_discover", () => ({ skillPaths: [skillPath] }))
    },
  }
}

/**
 * Packaged plugin skill wins; the source-tree copy keeps dev runs working (ast-grep pattern).
 * From the bundled extension at plugin/extensions/omo.js the packaged URL resolves to
 * plugin/skills-conditional/x-search/SKILL.md, the path stage-x-search-skill.mjs writes.
 * Returns undefined when neither copy exists: from the bundle the source-tree candidate would be
 * plugin/extensions/skill/SKILL.md, which senpi rejects as "skill path does not exist".
 */
export function resolveXSearchSkillPath(importerUrl: string = import.meta.url): string | undefined {
  const candidates = [
    fileURLToPath(new URL("../skills-conditional/x-search/SKILL.md", importerUrl)),
    fileURLToPath(new URL("./skill/SKILL.md", importerUrl)),
  ]
  return candidates.find((candidate) => existsSync(candidate))
}
