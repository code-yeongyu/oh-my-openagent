export class MemberValidationError extends Error {
  constructor(
    message: string,
    public readonly memberName?: string,
    public readonly issue?: string,
  ) {
    super(message)
    this.name = "MemberValidationError"
  }
}

function translateMemberError(
  input: Record<string, unknown>,
  agentEligibilityRegistry: Readonly<Record<string, { verdict: "eligible" | "conditional" | "hard-reject"; rejectionMessage?: string }>>,
): MemberValidationError {
  const name = typeof input.name === "string" ? input.name : "<unnamed>"
  const hasCategory = input.category != null
  const hasSubagentType = input.subagent_type != null
  const hasKind = input.kind === "category" || input.kind === "subagent_type"

  if (hasCategory && hasSubagentType) {
    return new MemberValidationError(
      `Member '${name}' specifies both 'category' and 'subagent_type'. Must specify exactly one via 'kind' discriminator.`,
      name,
      "both-kinds",
    )
  }

  if (!hasKind && !hasCategory && !hasSubagentType) {
    return new MemberValidationError(
      `Member '${name}' missing 'kind' discriminator. Specify either {kind:'category', category, prompt} or {kind:'subagent_type', subagent_type}.`,
      name,
      "missing-kind",
    )
  }

  if (input.kind === "category" || (!hasKind && hasCategory)) {
    const category = typeof input.category === "string" ? input.category : "<unknown>"
    return new MemberValidationError(
      `Member '${name}' uses category '${category}' but is missing required 'prompt' field. Category members must supply a task prompt.`,
      name,
      "category-missing-prompt",
    )
  }

  if (input.kind === "subagent_type" || (!hasKind && hasSubagentType)) {
    const subagentType = typeof input.subagent_type === "string" ? input.subagent_type : String(input.subagent_type)
    if (typeof input.subagent_type !== "string" || !agentEligibilityRegistry[input.subagent_type]) {
      return new MemberValidationError(
        `Unknown subagent_type '${subagentType}'. Available ELIGIBLE agents: sisyphus, atlas, sisyphus-junior, hephaestus (if D-36 applied). Use delegate-task for read-only agents like oracle, librarian, explore, metis, momus, multimodal-looker.`,
        name,
        "unknown-subagent",
      )
    }
  }

  return new MemberValidationError(`Member '${name}' validation failed.`, name, "zod-residual")
}

export function createParseMember<TMember>(
  memberSchema: { safeParse(input: unknown): { success: true; data: TMember } | { success: false } },
  agentEligibilityRegistry: Readonly<Record<string, { verdict: "eligible" | "conditional" | "hard-reject"; rejectionMessage?: string }>>,
): (input: unknown) => TMember {
  return function parseMember(input: unknown) {
    if (input == null || typeof input !== "object") {
      throw new MemberValidationError("Member must be an object")
    }

    const raw = input as Record<string, unknown>
    const result = memberSchema.safeParse(
      raw.kind === undefined && (raw.category !== undefined || raw.subagent_type !== undefined)
        ? { ...raw, kind: raw.category !== undefined ? "category" : "subagent_type" }
        : raw,
    )

    if (!result.success) {
      throw translateMemberError(raw, agentEligibilityRegistry)
    }

    return result.data
  }
}
