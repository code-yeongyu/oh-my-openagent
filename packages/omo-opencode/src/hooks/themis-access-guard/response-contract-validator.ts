import { DeliberationResponseSchema } from "../../agents/themis/types"

const SOFTENING_PHRASES = [
  "challenging but workable",
  "still possible",
  "can be managed",
  "not ideal but",
  "with some effort",
  "could work if",
]

export function validateResponseContract(content: string): void {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    // Not JSON; may be YAML or pre-gate request; skip validation
    return
  }

  const result = DeliberationResponseSchema.safeParse(parsed)
  if (!result.success) {
    const missing = result.error.issues.map(i => i.path.join(".")).join(", ")
    throw new Error(
      `Themis output contract violation: missing or invalid fields [${missing}]. ` +
      `All 6 required fields must be present: verdict, rationale, proof_chain, sidecar_trace, provenance, bundle.`
    )
  }

  const response = result.data

  // Check for softened no_selectable_bundle
  if (response.verdict === "no_selectable_bundle") {
    const rationale = response.rationale.toLowerCase()
    for (const phrase of SOFTENING_PHRASES) {
      if (rationale.includes(phrase)) {
        throw new Error(
          `Themis output contract violation: softening forbidden. ` +
          `When verdict is no_selectable_bundle, rationale must be verbatim from sidecar. ` +
          `Found softening phrase: "${phrase}"`
        )
      }
    }
  }

  // Check for raw ASPIC+ JSON leaking into primary fields
  const primaryFields = [response.verdict, response.rationale]
  for (const field of primaryFields) {
    if (typeof field === "string" && field.includes('"premises"') && field.includes('"defeasible_rules"')) {
      throw new Error(
        `Themis output contract violation: raw ASPIC+ JSON detected in primary output fields. ` +
        `Raw artifacts belong in sidecar_trace only.`
      )
    }
  }
}
