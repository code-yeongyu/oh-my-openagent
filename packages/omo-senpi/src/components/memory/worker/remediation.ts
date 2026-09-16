/**
 * Marks a detail built by `formatMemoryModelExhaustion`, which always closes with the roster of
 * models it tried. Model admission is finalized under the same `spawn_failed` reason as a real
 * executable-resolution failure (`overrideFailedReservationRun`), so this roster is the only thing
 * that tells the two producers apart - and no child, and therefore no executable, exists on it.
 */
const MODEL_EXHAUSTION_ROSTER = /\battempted:/

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
  // bwrap dies inside its own sandbox setup, before the reflection child ever execs, and the run
  // directory is pruned by the time this hint renders - so child-stderr.log is a dead pointer.
  if (/bwrap:|setting up (uid map|gid map|namespace)/.test(combined)) {
    return 'the sandbox helper (bwrap) cannot create a user namespace on this host; set memory.reflection.sandbox to "off" in your omo config, or allow unprivileged user namespaces on the host'
  }
  // Model admission never reached an executable, so none of these may mention SENPI_BIN, and none
  // may point at a child log that no child wrote.
  if (MODEL_EXHAUSTION_ROSTER.test(combined)) {
    if (combined.includes("provider_unavailable")) {
      return "every model for the memory reflection category was refused by its provider (rate limit or outage); automatic reflection resumes at the next probe, or run /reflect once the provider recovers"
    }
    if (combined.includes("context_overflow")) {
      return "the reflection prompt outgrew the context window of every candidate model; run /dream to trim system memory, or point memory.reflection at a larger-context model"
    }
    if (combined.includes("auth_missing") || combined.includes("api key")) {
      return "run /login <provider>"
    }
    return "no model for the memory reflection category could be admitted; the models that were tried are named in the failure detail"
  }
  // Only a PRE-SPAWN failure means the executable could not be resolved. A child that started and
  // then died on a missing file also reports ENOENT, and pointing at SENPI_BIN there is a
  // misdiagnosis: the omo launcher deletes SENPI_BIN from the engine environment, so that advice
  // cannot even be applied. Post-spawn ENOENT falls through to the child-log hint below.
  if (reason === "spawn_failed" || combined.includes("execvp")) {
    return "senpi executable not resolvable for the reflection child; set SENPI_BIN"
  }
  if (combined.includes("api key") || combined.includes("auth_missing")) {
    return "run /login <provider>"
  }
  return "inspect runtime/reflection-sessions/<runId>/child-stderr.log"
}
