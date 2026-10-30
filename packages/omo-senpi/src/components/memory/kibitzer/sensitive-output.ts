// Mirror of senpi `core/sensitive-output` (2026.10.27-2). senpi does not export that module from its
// package entry and omo-senpi may only import senpi types, so the sidecar carries the same rules verbatim:
// the environment-assignment and bearer patterns here, and senpi-ai's `redactCredentialShapes` in
// `sensitive-output-shapes.ts`. senpi also replaces the config reference values it resolved in its own process
// (`redactResolvedReferenceValues`); that set lives in the engine and is empty here, so the step is a no-op for the
// sidecar. `events-redaction.test.ts` pins this file to the real dist module so a senpi bump that changes the
// upstream rules fails loudly instead of drifting.

import { redactCredentialShapes } from "./sensitive-output-shapes"

// An environment assignment whose name contains a credential word. One class up to the "=", anchored at a word start,
// keeps the match linear (senpi#4283). The name test runs once per assignment on that name only.
const ENV_ASSIGNMENT = /\b([A-Z][A-Z0-9_]*)=([^\s'"]+)/g
const ENV_SECRET_WORD = /API_KEY|SECRET|TOKEN|PASSWORD|AUTH/

export function redactSensitiveOutput(text: string): string {
  return redactSensitiveTokenValues(text
    .replace(ENV_ASSIGNMENT, (all, name: string) => ENV_SECRET_WORD.test(name.slice(1)) ? `${name}=[REDACTED]` : all)
    .replace(/\b(Authorization:\s*Bearer\s+)([^\s'"]+)/gi, "$1[REDACTED]")
    .replace(/\b(Bearer\s+)(sk-[A-Za-z0-9._-]+)/g, "$1[REDACTED]"))
}

export function redactSensitiveTokenValues(text: string, replacement = "[REDACTED]"): string {
  return redactCredentialShapes(text, replacement)
}
