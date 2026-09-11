// Mirror of senpi `core/sensitive-output` (2026.9.10-2). senpi does not export that module from its
// package entry and omo-senpi may only import senpi types, so the sidecar carries the same three
// patterns verbatim. `events-redaction.test.ts` pins this file to the real dist module so a senpi
// bump that changes the upstream patterns fails loudly instead of drifting.

export function redactSensitiveOutput(text: string): string {
  return redactSensitiveTokenValues(text
    .replace(/\b([A-Z][A-Z0-9_]*(?:API_KEY|SECRET|TOKEN|PASSWORD|AUTH)[A-Z0-9_]*)=([^\s'"]+)/g, "$1=[REDACTED]")
    .replace(/\b(Authorization:\s*Bearer\s+)([^\s'"]+)/gi, "$1[REDACTED]")
    .replace(/\b(Bearer\s+)(sk-[A-Za-z0-9._-]+)/g, "$1[REDACTED]"))
}

export function redactSensitiveTokenValues(text: string, replacement = "[REDACTED]"): string {
  return text
    .replace(/\bghp_[A-Za-z0-9]{20,}\b/g, replacement)
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, replacement)
}
