import { join } from "node:path"
import type { SenpiExtensionAPI } from "../../extension/types"
import { getBuiltinSkillsRoot } from "../telemetry/product-identity"
import { readDisabledSkills, resolveBundledSkillProvenance } from "./contributed-skill"

/** Resolve once per dispatch; a shadowed or disabled name cannot select the bundled file. */
export function bundledSkillReference(pi: SenpiExtensionAPI): (name: string) => string {
  const root = getBuiltinSkillsRoot()
  const disabled = readDisabledSkills(pi.cwd ?? process.cwd(), process.env)
  return (name) => {
    const path = join(root, name, "SKILL.md")
    return disabled.has(name) || resolveBundledSkillProvenance(pi, name, path).shadowed
      ? path
      : `the built-in \`${name}\` skill`
  }
}
