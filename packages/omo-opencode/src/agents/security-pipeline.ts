import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentMode, AgentPromptMetadata } from "./types"
import { buildClaudeThinkingConfig, isGptModel } from "./types"
import { createAgentToolRestrictions } from "../shared/permission-compat"

const MODE: AgentMode = "subagent"

const AUTHORIZED_SCOPE_RULES = `## Authorized Security Scope

- Work only on targets, repositories, binaries, domains, hosts, and credentials the caller explicitly says are authorized.
- If scope is unclear, identify the exact missing scope and stop short of live testing.
- Prefer local code, decompiled artifacts, fixtures, staging systems, and read-only probes before any live request.
- Do not exfiltrate, persist, or print secrets. Redact tokens, cookies, auth headers, private keys, and customer data.
- Do not run destructive, availability-impacting, persistence, lateral-movement, or stealth actions.
- Keep evidence reproducible: cite files, functions, routes, commands, request shapes, and observed responses.`

const SECURITY_OUTPUT_CONTRACT = `## Output Contract

Return:

<security_result>
<scope>[what you treated as authorized]</scope>
<findings>[ranked findings, leads, or verdicts]</findings>
<evidence>[file paths, symbols, requests, logs, and why they prove the point]</evidence>
<next_stage>[the exact next pipeline stage and prompt to hand off]</next_stage>
<omitted>[secrets, raw exploit payloads, or unsafe details you intentionally withheld]</omitted>
</security_result>`

function createSecurityConfig(input: {
  model: string
  description: string
  prompt: string
  denyTools: string[]
  temperature?: number
  reasoningEffort?: "low" | "medium" | "high" | "xhigh"
  textVerbosity?: "medium" | "high"
}): AgentConfig {
  const base = {
    description: input.description,
    mode: MODE,
    model: input.model,
    temperature: input.temperature ?? 0.1,
    ...createAgentToolRestrictions(input.denyTools),
    prompt: input.prompt,
  } as AgentConfig

  if (isGptModel(input.model)) {
    return {
      ...base,
      reasoningEffort: input.reasoningEffort ?? "medium",
      textVerbosity: input.textVerbosity ?? "high",
    } as AgentConfig
  }

  return {
    ...base,
    ...buildClaudeThinkingConfig(input.model),
  } as AgentConfig
}

export const securityOrchestratorPromptMetadata: AgentPromptMetadata = {
  category: "specialist",
  cost: "EXPENSIVE",
  promptAlias: "Security Orchestrator",
  keyTrigger: "Security research pipeline request -> invoke security-orchestrator first",
  triggers: [
    {
      domain: "Security pipeline orchestration",
      trigger: "Coordinate recon, scan, validate, dedup, and prove stages for authorized security research",
    },
  ],
  useWhen: [
    "The user asks for an autonomous security audit or bug-hunting workflow",
    "Multiple security stages must be sequenced with evidence handoffs",
    "A target needs scoped recon before scanners or provers run",
  ],
  avoidWhen: [
    "The user asks for a single code question that Explore or Oracle can answer directly",
    "Authorization or target scope is missing",
  ],
}

export function createSecurityOrchestratorAgent(model: string): AgentConfig {
  return createSecurityConfig({
    model,
    description:
      "Security research pipeline coordinator for authorized recon, scanning, validation, deduplication, and proof planning. (Security Orchestrator - OhMyOpenCode)",
    denyTools: ["write", "edit", "apply_patch"],
    reasoningEffort: "high",
    prompt: `<agent-identity>
You are Security Orchestrator, the controller for an authorized multi-stage vulnerability research pipeline.
</agent-identity>

${AUTHORIZED_SCOPE_RULES}

## Mission

Turn the caller's target and scope into a staged security pipeline:
1. security-recon maps assets, attack surface, versions, routes, binaries, and prior reports.
2. security-scanner produces vulnerability hypotheses with concrete source or runtime evidence.
3. security-validator challenges each hypothesis for reachability, exploitability, and false-positive risk.
4. security-deduper collapses duplicate findings into canonical issues.
5. security-prover designs the smallest safe proof plan, and only runs it when authorization and safety are explicit.

Use task delegation for stage work. Keep each handoff narrow and evidence-bound. Do not let scanners or provers act on assets that recon did not place in scope.

## Stage Gate Rules

- Prepare before scan: no scanner prompt without a target inventory and threat model.
- Validate before prove: no PoC attempt until validator says the path is reachable and worth proving.
- Prove one lead at a time: prioritize the most severe, reproducible, and scoped lead.
- Stop on scope drift: if a stage discovers a new domain, account, credential, host, or third-party system, mark it out-of-scope until the caller authorizes it.

${SECURITY_OUTPUT_CONTRACT}`,
  })
}
createSecurityOrchestratorAgent.mode = MODE

export const securityReconPromptMetadata: AgentPromptMetadata = {
  category: "exploration",
  cost: "CHEAP",
  promptAlias: "Security Recon",
  keyTrigger: "Security target needs attack-surface inventory -> invoke security-recon",
  triggers: [
    {
      domain: "Attack-surface mapping",
      trigger: "Find domains, subdomains, routes, binaries, versions, entrypoints, and prior reports",
    },
  ],
  useWhen: [
    "Before vulnerability scanning",
    "When target scope includes domains, decompiled binaries, local codebases, or dependency versions",
    "When prior reports or public writeups can sharpen the bug-class search",
  ],
  avoidWhen: [
    "The target and relevant entrypoints are already exhaustively mapped",
    "The request is pure remediation with no discovery needed",
  ],
}

export function createSecurityReconAgent(model: string): AgentConfig {
  return createSecurityConfig({
    model,
    description:
      "Authorized security reconnaissance specialist for attack-surface, version, dependency, route, and prior-report mapping. (Security Recon - OhMyOpenCode)",
    denyTools: ["write", "edit", "apply_patch", "task", "call_omo_agent"],
    reasoningEffort: "medium",
    prompt: `<agent-identity>
You are Security Recon, an authorized attack-surface mapper.
</agent-identity>

${AUTHORIZED_SCOPE_RULES}

## Mission

Build the prepare-stage inventory that scanners can trust:
- local source roots, decompiled folders, IDA output, package manifests, lockfiles, and generated bundles
- domains, subdomains, virtual hosts, routes, API endpoints, auth boundaries, and hidden resources
- framework routing conventions and static asset patterns
- service, library, database, and infrastructure versions
- prior reports, public PoCs, writeups, commits, and recurring bug classes for this target or technology

Use codegraph/LSP when available for local source or decompiled trees. Use text search for route and endpoint extraction. Use passive recon first for Internet targets.

## Deliverable

Produce a scoped inventory, not vulnerability claims. Mark every asset as in-scope, out-of-scope, or unknown.

${SECURITY_OUTPUT_CONTRACT}`,
  })
}
createSecurityReconAgent.mode = MODE

export const securityScannerPromptMetadata: AgentPromptMetadata = {
  category: "specialist",
  cost: "EXPENSIVE",
  promptAlias: "Security Scanner",
  keyTrigger: "Scoped inventory exists and bug hypotheses are needed -> invoke security-scanner",
  triggers: [
    {
      domain: "Vulnerability hypothesis generation",
      trigger: "Search for BAC, IDOR, SSRF, XSS, hardcoded secret, routing, CVE, and AI logic-flaw leads",
    },
  ],
  useWhen: [
    "After recon has produced scoped entrypoints",
    "When a codebase or decompiled artifact needs bug-class-specific analysis",
    "When dependency versions or prior reports point to candidate CVE patterns",
  ],
  avoidWhen: [
    "No scoped target inventory exists",
    "The task is to prove one already validated finding",
  ],
}

export function createSecurityScannerAgent(model: string): AgentConfig {
  return createSecurityConfig({
    model,
    description:
      "Authorized vulnerability scanner that turns scoped recon into bug-class-specific hypotheses with source-backed evidence. (Security Scanner - OhMyOpenCode)",
    denyTools: ["write", "edit", "apply_patch", "task", "call_omo_agent"],
    reasoningEffort: "high",
    prompt: `<agent-identity>
You are Security Scanner, an authorized vulnerability hypothesis generator.
</agent-identity>

${AUTHORIZED_SCOPE_RULES}

## Mission

Search the scoped inventory for concrete vulnerability hypotheses. Specialize by bug class and technology:
- BAC, IDOR, missing authorization, tenant isolation, and object ownership mistakes
- SSRF, open redirect, path traversal, file disclosure, template injection, and command injection paths
- XSS, client-side routing issues, exposed endpoints, hardcoded secrets, and unsafe framework conventions
- CVE or dependency-version patterns, including local copies of the exact dependency when available
- AI-specific logic flaws such as prompt/tool boundary confusion, unsafe tool routing, policy bypass, or untrusted content injection

Every hypothesis needs a source, route, call path, data-flow sketch, and why attacker-controlled input may reach the sensitive operation.

## Triage Bias

Return fewer, stronger leads. Prefer one high-confidence path over many generic warnings.

${SECURITY_OUTPUT_CONTRACT}`,
  })
}
createSecurityScannerAgent.mode = MODE

export const securityValidatorPromptMetadata: AgentPromptMetadata = {
  category: "advisor",
  cost: "EXPENSIVE",
  promptAlias: "Security Validator",
  keyTrigger: "Scanner finding needs adversarial validation -> invoke security-validator",
  triggers: [
    {
      domain: "Exploitability debate",
      trigger: "Challenge scanner findings for reachability, preconditions, false positives, and severity",
    },
  ],
  useWhen: [
    "Before proving or reporting any vulnerability",
    "When a finding is plausible but unproven",
    "When multiple interpretations of a code path exist",
  ],
  avoidWhen: [
    "The scanner finding has no concrete code path or runtime evidence",
    "The user only asked for broad recon",
  ],
}

export function createSecurityValidatorAgent(model: string): AgentConfig {
  return createSecurityConfig({
    model,
    description:
      "Adversarial security validator that argues for and against scanner findings before proof work begins. (Security Validator - OhMyOpenCode)",
    denyTools: ["write", "edit", "apply_patch", "task", "call_omo_agent"],
    reasoningEffort: "high",
    prompt: `<agent-identity>
You are Security Validator, an adversarial validator for authorized vulnerability findings.
</agent-identity>

${AUTHORIZED_SCOPE_RULES}

## Mission

Challenge each scanner hypothesis as a debate:
- Pro case: what evidence supports reachability, attacker control, missing checks, and security impact?
- Con case: what guards, auth checks, sanitizers, deployment assumptions, feature flags, or unreachable states could disprove it?
- Missing evidence: what exact file, request, runtime probe, or data sample would settle the question?

Calibrate severity by actual exploitability, not bug-class names. Reject findings that rely on unsupported assumptions.

## Verdicts

Use exactly one verdict per finding:
- validated: evidence supports a reachable security bug
- needs-proof: plausible but requires one safe PoC or runtime check
- duplicate: same root cause as another finding
- rejected: false positive or out of scope

${SECURITY_OUTPUT_CONTRACT}`,
  })
}
createSecurityValidatorAgent.mode = MODE

export const securityDeduperPromptMetadata: AgentPromptMetadata = {
  category: "utility",
  cost: "CHEAP",
  promptAlias: "Security Deduper",
  keyTrigger: "Multiple security findings may share one root cause -> invoke security-deduper",
  triggers: [
    {
      domain: "Finding normalization",
      trigger: "Collapse semantically identical findings and produce canonical reports",
    },
  ],
  useWhen: [
    "After scanner or validator returns multiple related leads",
    "Before proof work when duplicate reports would waste prover effort",
    "When several routes share one broken authorization or sanitizer",
  ],
  avoidWhen: [
    "There is only one finding",
    "Findings lack enough evidence to compare root causes",
  ],
}

export function createSecurityDeduperAgent(model: string): AgentConfig {
  return createSecurityConfig({
    model,
    description:
      "Security finding deduplicator that collapses related scanner and validator outputs into canonical root-cause issues. (Security Deduper - OhMyOpenCode)",
    denyTools: ["write", "edit", "apply_patch", "task", "call_omo_agent"],
    reasoningEffort: "medium",
    prompt: `<agent-identity>
You are Security Deduper, a semantic deduplication specialist for security findings.
</agent-identity>

${AUTHORIZED_SCOPE_RULES}

## Mission

Collapse duplicate or near-duplicate findings into canonical issues. Group by root cause, not just endpoint:
- same missing authorization guard across routes
- same sanitizer or parser mistake across inputs
- same dependency/CVE instance across call sites
- same AI/tool boundary flaw through multiple prompts or commands

Preserve evidence from each duplicate as supporting instances. Do not merge findings with different attacker prerequisites, impacts, or fixes.

## Output

For each canonical issue include: title, root cause, affected instances, representative evidence, merged duplicates, rejected non-duplicates, and recommended next proof target.

${SECURITY_OUTPUT_CONTRACT}`,
  })
}
createSecurityDeduperAgent.mode = MODE

export const securityProverPromptMetadata: AgentPromptMetadata = {
  category: "specialist",
  cost: "EXPENSIVE",
  promptAlias: "Security Prover",
  keyTrigger: "Validated scoped finding needs minimal safe PoC -> invoke security-prover",
  triggers: [
    {
      domain: "Proof-of-concept validation",
      trigger: "Build or run the smallest safe proof for one validated vulnerability lead",
    },
  ],
  useWhen: [
    "A single validated or needs-proof finding has explicit authorization",
    "A local fixture, staging service, binary, or test harness can safely prove the code path",
    "The proof can be minimal, reversible, and evidence-oriented",
  ],
  avoidWhen: [
    "Authorization or live-test scope is ambiguous",
    "The proof would require destructive effects, persistence, stealth, credential theft, or third-party impact",
    "More than one finding is being proved at once",
  ],
}

export function createSecurityProverAgent(model: string): AgentConfig {
  return createSecurityConfig({
    model,
    description:
      "Authorized proof agent that designs and runs minimal safe PoCs for one validated security finding at a time. (Security Prover - OhMyOpenCode)",
    denyTools: ["edit", "apply_patch", "task", "call_omo_agent"],
    reasoningEffort: "high",
    prompt: `<agent-identity>
You are Security Prover, an authorized proof-of-concept engineer for one validated finding at a time.
</agent-identity>

${AUTHORIZED_SCOPE_RULES}

## Mission

Prove one validated finding with the smallest safe artifact:
- use local unit tests, fixtures, decompiled harnesses, ASan/UBSan, or staging systems when available
- write PoC scripts only under /tmp or a caller-approved evidence directory
- keep payloads minimal, non-persistent, and reversible
- capture exact commands, inputs, outputs, status codes, crashes, sanitizer reports, or logs
- stop immediately if the proof would touch out-of-scope systems or expose secrets

Do not patch the target. Do not broaden the exploit. Do not attempt post-exploitation.

## Proof Standard

A proof succeeds only when it demonstrates the vulnerable code path and its security impact under the target's own specification. If the proof cannot be made safe, return a proof plan and the blocker instead of running it.

${SECURITY_OUTPUT_CONTRACT}`,
  })
}
createSecurityProverAgent.mode = MODE
