# Why this evidence is enough for PR review

The raw-pipe probes execute the rebuilt public hook CLI with the real filesystem adapter and full input payloads. They distinguish each requested receipt outcome, record the timestamps for stale/fresh decisions, and use separate scratch directories so the existing three-attempt escape hatch cannot turn a failing receipt into a false pass. This covers the changed runtime behavior without asking a model to perform work.

The generated doctor skill was reviewed directly rather than asserted by prose tests. Its catalog-keyed verdict, version floor, cache handling, remediation, and table structure are visible in the recorded read. The remote Node suite independently exercised the machine-consumed frontmatter and bundled component contracts.

The real Codex app-server loaded the locally installed plugin and emitted paired started/completed notifications for rules and ultrawork. Parsing the actual JSON summary avoided trusting the helper's exit code alone. The installer bundle is generated, version-aligned, and stable under regeneration; the actual plugin build and local tsgo completed successfully.

Two approaches were considered: preserve the product and classify the supplied baseline/runner results, or expand the patch to repair environment-sensitive wrappers and force the plan's hook count onto macOS. The evidence-only approach wins because the task forbids product changes and the existing non-Windows hook filter explains the 19/21 mismatch. Neither that mismatch nor the red remote gate is concealed or relabeled as a green gate.

This is sufficient to open a reviewer-readable PR, not to approve a merge. The orchestrator owns CI, review follow-through, the installed-hook-count plan discrepancy, and merging. The volume incident explains why the task-15/16 proofs were regenerated from the pushed commits rather than recovered from the original worktree.
