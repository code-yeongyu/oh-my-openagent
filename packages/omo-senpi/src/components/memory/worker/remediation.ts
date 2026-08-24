export function reflectionRemediation(reason: string | undefined, detail: string | undefined): string {
  const combined = `${reason ?? ""} ${detail ?? ""}`.toLowerCase()
  if (combined.includes("budget_not_met")) {
    return "run /dream again and trim or demote the largest system/ files until the committed estimate is below $SYSTEM_TOKEN_TARGET"
  }
  // Pre-spawn resolution failure: no child ever ran, so never point at child-stderr.log here.
  if (combined.includes("category_unavailable") || combined.includes("could not resolve a usable model")) {
    return "no connected provider offers a model for the memory reflection category; run /login <provider>, or pin categories.<category>.model (or memory.reflection.category) in omo.json"
  }
  // The senpi child prints `Error: Model "<selector>" not found. Use --list-models ...`, so the quoted
  // selector has to be matched too, otherwise a repeating model miss degrades to the generic child-log hint.
  if (
    combined.includes("model-not-found")
    || combined.includes("model_not_visible")
    || combined.includes("model not found")
    || /model\s+"[^"]+"\s+not found/.test(combined)
  ) {
    return "the reflection child cannot see the configured category model; adjust memory.reflection category/model in your omo config"
  }
  // A provider 400 on reasoning.effort is a config/capability mismatch, not a crash:
  // the child-stderr hint below would send the reader to a log that only repeats the
  // same line. Name the rejected parameter instead.
  // Scope this to the reasoning parameter only. An unsupported_value for temperature,
  // max_tokens or anything else must not be told to change the reasoning level.
  if (
    combined.includes("reasoning.effort")
    || combined.includes("reasoningeffort")
    || (combined.includes("unsupported_value") && combined.includes("reasoning"))
  ) {
    return "the provider rejected the reasoning effort for this model; set categories.<category>.reasoning (the category memory.reflection.category points at) to a value the model accepts, or pick another model"
  }
  if (combined.includes("spawn") || combined.includes("enoent")) {
    return "senpi executable not resolvable for the reflection child; set SENPI_BIN"
  }
  if (combined.includes("api key") || combined.includes("auth_missing")) {
    return "run /login <provider>"
  }
  // The run dir is `runtime/reflection/runs/<runId>` (reflection-spawn-input.ts builds
  // `reflectionSessionsDir` from `paths.reflection` + "runs"), so the hint must name that
  // path -- `runtime/reflection-sessions/` is a vestigial layout entry nothing writes to.
  return "inspect runtime/reflection/runs/<runId>/child-stderr.log"
}
