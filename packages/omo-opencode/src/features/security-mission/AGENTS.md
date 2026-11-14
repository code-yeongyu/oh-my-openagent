# src/features/security-mission/ — Security Mission Framework

## OVERVIEW

Config-gated feature module providing a structured security audit lifecycle inspired by the Tempest framework's core honesty-gate abstractions. Provides a mission state machine, a provenance-gated findings ledger, a scope containment model, and disclosure-ready report generation.

The existing `security-research` skill orchestrates parallel agents for codebase security audits via Team Mode. This module provides the runtime infrastructure that any security audit (single-agent or Team Mode) can use: a findings ledger where every claim is stamped with provenance, a scope model for containment, and coordinated disclosure draft generation.

## DESIGN

Adapted from Tempest's core abstractions:

- **Provenance Gate** (Tempest `evidence/gate.ts`): every finding is stamped `provenance: 'tool' | 'context' | 'none'` based on whether real tool output backs it. The gate runs in the live path (`addFinding`), not as an opt-in. A model-asserted finding is recorded but left unverified.
- **Evidence Ladder** (Tempest `verify-finding.mjs`): `claimed -> source-verified -> poc-built -> poc-executed`. Only tool-backed findings are eligible for disclosure drafts.
- **Scope Model** (Tempest `arsenal/index.ts`): an allowlist enforced at the boundary. Hosts are normalized (URL extraction, CIDR mask-strip, `www.` prefix removal). Loopback/private hosts denied unless explicitly allowed.
- **Disclosure Draft** (Tempest `disclosure-gen.mjs`): drafts only, never sends. A human reviews and sends. Includes provenance gate metadata for each finding.

## FILES

| File | Purpose |
|------|---------|
| `types.ts` | Zod schemas + TS types: Mission, Finding, Scope, Provenance, EvidenceLevel, VerifyGate |
| `finding-gate.ts` | `gateFinding()` provenance check — the honesty spine |
| `scope-guard.ts` | `scopeViolation()` host normalization + allowlist check |
| `storage.ts` | Atomic JSON persistence (temp file + rename) |
| `mission-store.ts` | `MissionStore` class — create/query missions, add/verify findings |
| `disclosure-report.ts` | `generateReport()` — summary or disclosure-ready markdown |
| `index.ts` | Barrel exports |

## CONFIG

```jsonc
{
  "security_mission": {
    "enabled": true,
    "max_findings": 500,
    "persistence_dir": null
  }
}
```

When `enabled: true`, 4 `security_*` tools register.

## TOOLS (4, gated on `security_mission.enabled`)

| Tool | Purpose |
|------|---------|
| `security_mission_start` | Start a new security mission with scope definition |
| `security_finding_add` | Add a finding with automatic provenance stamping |
| `security_finding_verify` | Re-run the provenance gate on a finding |
| `security_mission_report` | Generate a summary or disclosure-ready report |

## PROVENANCE GATE INVARIANTS

1. **Provenance is the door, not a decoration.** The gate runs inside `addFinding()`, not as an opt-in verify call.
2. **Tool-backed evidence is required for all severities to pass the gate.** Findings without tool-backed evidence are recorded but left unverified.
3. **A model-asserted finding is recorded but left unverified.** It is not eligible for disclosure drafts.
4. **Drafts only, human sends.** The disclosure report includes a mandatory human-review disclaimer.
5. **Classification, not verification.** The gate classifies evidence based on its declared `kind` field (a controlled vocabulary: `output`/`command`/`response`/`request`/`log`/`file` = tool-backed; anything else = contextual). The freeform `source` field was removed to avoid implying trust the gate cannot verify. A true provenance guarantee would require a trusted execution stamp from the tool framework itself; this module provides a first-pass filter, not a zero-trust guarantee.
