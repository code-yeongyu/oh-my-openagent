import { getBuiltinSkillsRoot } from "../telemetry/product-identity"

export interface SkillPointerTarget {
  readonly skillName: string
  readonly customType: string
  readonly pattern: RegExp
  readonly expandedBlockPattern: RegExp
  readonly instruction: string
  readonly extra?: (sessionScope: string | null) => string
  readonly companions?: readonly SkillCompanion[]
  // A binding target enters its mode instead of asking the model whether the user meant it: the
  // conditional pointer let the model skip mass-ulw entirely (#10810). Binding is POSITIVE: only a
  // fixed request form matches (`bindingForms`). Every other mention (a statement or a
  // question about the skill, a relayed report, the plain-word alias `meth`) keeps the conditional
  // pointer, because forcing a workflow run onto it is the wrong answer.
  readonly bindingPattern?: RegExp
  // A target with no packaged skill: the pointer is this text instead of a SKILL.md read.
  readonly pointer?: string
}

// A companion is a skill the parent workflow runs on. It has no keyword of its own: it rides on
// every invocation of its parent, including the paths that dedup the parent's own pointer
// (a raw `/skill:<parent>` command, an expanded `<skill name="<parent>">` block), and is skipped
// only when the input already carries the companion itself.
export interface SkillCompanion {
  readonly skillName: string
  readonly customType: string
  readonly expandedBlockPattern: RegExp
  readonly role: string
  readonly instruction: string
}

// A keyword proves a mention, not a request to run the workflow.
export function skillPointer(target: SkillPointerTarget, sessionScope: string | null): string {
  const skillsRoot = getBuiltinSkillsRoot()
  const extra = target.extra?.(sessionScope) ?? ""
  return `<omo-${target.skillName}-pointer>This message mentions ${target.skillName}. If the user of this session is asking to run ${target.skillName}, read the ${target.skillName} skill at ${skillsRoot}${target.skillName}/SKILL.md with the read tool and follow it: ${target.instruction}. ${ignoreWhenOnlyDiscussed(target.skillName)}${extra}</omo-${target.skillName}-pointer>`
}

// The guard every conditional pointer ends with: a keyword proves a mention, so a mention that is only talk is ignored.
export function ignoreWhenOnlyDiscussed(subject: string): string {
  return `If ${subject} is only being discussed, quoted, or relayed from another session, ignore this pointer.`
}

export function companionPointer(parent: SkillPointerTarget, companion: SkillCompanion, binding: boolean): string {
  const skillsRoot = getBuiltinSkillsRoot()
  if (binding) {
    return `<omo-${companion.skillName}-pointer>${parent.skillName} ${companion.role}. Read the ${companion.skillName} skill at ${skillsRoot}${companion.skillName}/SKILL.md with the read tool in the same turn as the ${parent.skillName} skill and ${companion.instruction}.</omo-${companion.skillName}-pointer>`
  }
  return `<omo-${companion.skillName}-pointer>${parent.skillName} ${companion.role}. If the user of this session is asking to run ${parent.skillName}, read the ${companion.skillName} skill at ${skillsRoot}${companion.skillName}/SKILL.md with the read tool in the same turn as the ${parent.skillName} skill and ${companion.instruction}. ${ignoreWhenOnlyDiscussed(parent.skillName)}</omo-${companion.skillName}-pointer>`
}
