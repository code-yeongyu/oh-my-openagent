import { existsSync } from "@oh-my-opencode/memory-core/fs"
import { join } from "node:path"

import type { SenpiExtensionAPI } from "../../extension/types"
import type { MemoryIdentityContext } from "./context"

/**
 * Structural match of senpi's ResourcesDiscoverResult (core/extensions/types.ts). Declared
 * locally because the senpi package root does not re-export the event result types; the
 * handler is registered through SenpiExtensionAPI.on, which is payload-agnostic.
 */
export interface MemorySkillsDiscoverResult {
  readonly skillPaths?: string[]
}

/**
 * Agent memfs skills exposure via senpi's resources_discover event.
 *
 * letta 5-layer skills precedence -> omo/senpi mapping:
 *   letta project (.agents/skills canonical)       -> senpi project scope (<cwd>/.pi/skills)
 *   letta agent (~/.letta/agents/<id>/memory/skills) -> THIS layer: resources_discover skillPaths
 *                                                     (<memory repo>/skills)
 *   letta memory-fallback ($LETTA_MEMORY_DIR|$MEMORY_DIR/skills) -> NO omo analog
 *                                                     (recorded divergence, intentionally unported)
 *   letta global (~/.letta/skills)                 -> senpi user scope (<agentDir>/skills)
 *   letta bundled (src/skills/builtin)             -> senpi builtin skills
 *
 * Precedence note (spike-pinned): senpi resolves skill name collisions first-path-wins, and
 * extension-provided paths are appended AFTER the pre-existing CLI/project/user/builtin
 * discovery set. Memory skills therefore load additively and yield on name collision rather
 * than displacing any existing skill.
 *
 * Missing dirs contribute nothing, avoiding a startup diagnostic for first-run identities.
 * Reflection-authored skills committed under skills/<name>/SKILL.md are picked up on the next
 * session_start (reason "startup") or /reload (reason "reload"); dir shape is enforced by the
 * memory repo pre-commit hooks, not by this component.
 */

export const MEMORY_SKILLS_DIRNAME = "skills"

export interface MemorySkillsScopeOptions {
  readonly resolveContext: (sessionId: string) => MemoryIdentityContext | undefined
}

export function memorySkillsDir(context: MemoryIdentityContext): string {
  return join(context.identityPaths.repo, MEMORY_SKILLS_DIRNAME)
}

/**
 * resources_discover handler: returns the bound identity's memfs skills dir. Unbound or
 * unreadable sessions return undefined so the handler chain passes through untouched and no
 * path is contributed.
 */
export function createMemorySkillsScopeHandler(
  options: MemorySkillsScopeOptions,
): (payload: unknown, eventCtx?: unknown) => MemorySkillsDiscoverResult | undefined {
  return (payload, eventCtx) => {
    if (!isResourcesDiscoverPayload(payload)) return undefined
    const sessionId = readSessionId(eventCtx)
    if (sessionId === undefined) return undefined
    const context = options.resolveContext(sessionId)
    if (context === undefined) return undefined
    const skillsDir = memorySkillsDir(context)
    return existsSync(skillsDir) ? { skillPaths: [skillsDir] } : undefined
  }
}

export function registerMemorySkillsScope(pi: SenpiExtensionAPI, options: MemorySkillsScopeOptions): void {
  pi.on("resources_discover", createMemorySkillsScopeHandler(options))
}

function isResourcesDiscoverPayload(payload: unknown): boolean {
  return isRecord(payload) && payload.type === "resources_discover"
}

function readSessionId(eventCtx: unknown): string | undefined {
  if (!isRecord(eventCtx)) return undefined
  const manager = isRecord(eventCtx.sessionManager) ? eventCtx.sessionManager : undefined
  if (manager === undefined) return undefined
  const getSessionId = manager.getSessionId
  if (typeof getSessionId !== "function") return undefined
  const id = Reflect.apply(getSessionId, manager, [])
  return typeof id === "string" && id.length > 0 ? id : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
