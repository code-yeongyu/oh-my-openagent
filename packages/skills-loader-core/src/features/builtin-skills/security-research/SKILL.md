# Security Research - Team Mode Vulnerability Audit

Use this skill to run a parallel security audit that separates real exploitability from generic concern. The team has 3 vulnerability hunters and 2 PoC engineers.

## Hard Preconditions

Before starting, verify:

1. `team_*` tools are available. If not, stop and tell the user:
   `security-research requires team-mode. Set team_mode.enabled: true in your oh-my-openagent config, restart opencode, then retry.`
2. You are in the main session, not a background subagent.
3. You have a concrete target: repository, diff range, PR, release candidate, path list, or threat surface.

If the user provided no target, audit the current repository and current branch diff against its upstream or merge base. If there is no diff, audit the security-sensitive surfaces in the working tree.

## Severity Standard

Use these references as the scoring frame:

- CWE for root-cause weakness classification: https://cwe.mitre.org/
- OWASP WSTG for test methodology: https://devguide.owasp.org/en/06-verification/01-guides/01-wstg/
- OWASP ASVS for control verification: https://owasp.org/www-project-application-security-verification-standard/
- CVSS v4.0 for exploitability and impact scoring: https://www.first.org/cvss/v4.0/specification-document

Rules:

- No severity without an attack path.
- No critical or high finding without concrete exploit preconditions and impact.
- Keep CWE category separate from severity.
- Prefer a small, reproducible PoC over theoretical language.
- Never run destructive exploits against real services or third-party systems.
- Use local fixtures, toy payloads, dry runs, or static proof when real execution would be unsafe.

## Team Roster

Create one Team Mode run with these 5 members:

| Member | Kind | Category | Role |
|--------|------|----------|------|
| `surface-hunter` | category | `deep` | Map entry points, trust boundaries, and reachable attack surfaces. |
| `auth-data-hunter` | category | `ultrabrain` | Hunt auth, authorization, data isolation, injection, and secret handling flaws. |
| `runtime-supply-hunter` | category | `unspecified-high` | Hunt filesystem, subprocess, archive, dependency, hook, MCP, and config risks. |
| `poc-engineer-a` | category | `unspecified-high` | Build minimal PoCs for the strongest candidate findings. |
| `poc-engineer-b` | category | `deep` | Independently reproduce, falsify, or downgrade candidate findings. |

Call `team_create` with an inline spec:

```typescript
team_create({
  inline_spec: {
    name: "security-research",
    description: "Parallel exploitability-driven security research team.",
    members: [
      {
        name: "surface-hunter",
        kind: "category",
        category: "deep",
        prompt: "You map attack surface. Enumerate entry points, trust boundaries, attacker-controlled inputs, data sinks, privilege transitions, and sensitive assets. Return evidence with file paths and exact functions. Do not assign severity unless you can name an attack path."
      },
      {
        name: "auth-data-hunter",
        kind: "category",
        category: "ultrabrain",
        prompt: "You hunt auth, authorization, tenant/data isolation, injection, SSRF, credential exposure, and confused-deputy flaws. Reason from attacker capability to impact. Return only findings with concrete exploit preconditions, CWE candidates, and verification steps."
      },
      {
        name: "runtime-supply-hunter",
        kind: "category",
        category: "unspecified-high",
        prompt: "You hunt filesystem, subprocess, archive extraction, dependency, hook execution, MCP, config, and environment-variable risks. Check path traversal, command injection, unsafe downloads, permission boundaries, and supply-chain assumptions. Cite file paths and commands used."
      },
      {
        name: "poc-engineer-a",
        kind: "category",
        category: "unspecified-high",
        prompt: "You build minimal safe PoCs for candidate findings. Use toy inputs and local-only execution. Your job is to prove or disprove exploitability, not to broaden scope. Report exact reproduction steps and expected output."
      },
      {
        name: "poc-engineer-b",
        kind: "category",
        category: "deep",
        prompt: "You independently reproduce candidate findings and try to falsify them. Downgrade anything without a working path. If a PoC is unsafe to run, design a safe static or dry-run proof and explain the limit."
      }
    ]
  }
})
```

If a category is unavailable, retry once by replacing only that category with `unspecified-high`. Do not reduce the team below 5 members.

## Workflow

### Phase 0: Scope and Baseline

Collect:

- Target scope and reason for audit.
- Branch, base ref, diff, and changed files if this is a change review.
- Security-sensitive directories and files if this is a full-repo audit.
- Existing tests and commands that exercise relevant surfaces.
- Any user-stated constraints, such as no network calls or no destructive tests.

Use `rg`, `git diff`, `git log`, LSP, and existing tests before assigning work.

### Phase 1: Independent Hunter Pass

Send one prompt to the 3 hunters:

```text
Audit target:
{target summary}

Context:
{diff, file list, security-sensitive paths, known constraints}

Task:
Find candidate vulnerabilities in your assigned role. For each candidate include:
- title
- affected file/function
- attacker capability
- attack path
- impact
- CWE candidate
- exact evidence
- safe verification idea

Reject generic hardening advice. Return only candidates with a plausible path.
```

Wait for all hunters.

### Phase 2: PoC Pass

Deduplicate hunter candidates. Send the strongest candidates to both PoC engineers.

Each PoC engineer must return:

- Reproduced, falsified, or unsafe-to-run.
- Exact commands, fixtures, or static proof.
- Observed output or reason it fails.
- Severity recommendation using exploitability and impact.
- Downgrade rationale for anything not reproduced.

### Phase 3: Cross-Check

Send the PoC results back to all 5 members.

Ask every member:

- Which findings survive?
- Which findings should be downgraded or removed?
- What remediation is smallest and specific?
- What regression test would prevent recurrence?

### Phase 4: Final Report

Produce this report:

```markdown
## Security Research Result

### Verdict
PASS | PASS WITH FINDINGS | BLOCK

### Scope
- Target:
- Base/diff:
- Commands run:

### Findings
| Severity | Title | CWE | Exploitability | Impact | PoC | Fix |
|----------|-------|-----|----------------|--------|-----|-----|

### Finding Details
For each finding:
- Evidence:
- Attack path:
- PoC:
- Severity rationale:
- Minimal fix:
- Regression check:

### Downgraded or Rejected Candidates
| Candidate | Reason |
|-----------|--------|

### Residual Risk
- What was not tested and why.
```

## Output Rules

- Lead with the verdict.
- Do not bury blocking issues.
- Do not report speculative findings as vulnerabilities.
- Do not claim CVSS precision unless you actually scored the metrics.
- Include exact file paths and commands for every surviving finding.
- If no findings survive PoC, say that plainly and list residual risk.
