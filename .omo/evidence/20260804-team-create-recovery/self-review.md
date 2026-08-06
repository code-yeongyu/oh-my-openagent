# Self-review

1. **Does the change need to exist?** Yes. Two independent Kimi sessions
   repeated the same dual-field call and could not recover despite correctly
   restating the XOR rule.
2. **Did the change reuse the existing seam?** Yes. The fix stays inside
   `runTeamCreate`; no new abstraction, compatibility layer, or parser was
   introduced.
3. **Is this the smallest correct behavior change?** Yes. `inline_spec`
   precedence replaces the single XOR rejection, and the descriptions now
   state the behavior. No unrelated error semantics changed.
4. **Are boundary and edge cases preserved?** Yes. Named-only calls still use
   named lookup, inline-only calls are unchanged, neither-input calls still
   return `invalid_arguments`, and malformed inline JSON still fails before
   the service call.
5. **Are types and diagnostics clean?** Yes. No `any`, suppression, or unsafe
   cast was added. Shared LSP daemon diagnostics reported zero issues on all
   changed TypeScript files.
6. **Is the proof faithful and deterministic?** Yes. The unit RED reconstructed
   the real payload. The live Senpi proof uses a local scripted provider and
   asserts one dual-field call, zero invalid-argument results, and a created
   two-member team.
7. **Is scope controlled?** Yes. The commit set is limited to the Senpi team
   lifecycle, focused regression coverage, the live QA script input, and the
   regenerated lead extension. Build-only Codex/install artifacts are excluded.

Residual risk:

- Other model-facing tools still use runtime-only mutually-exclusive
  arguments. This change intentionally does not generalize policy beyond the
  reported `team_create` failure.
- The first live QA attempt inherited the caller's HOME and therefore the
  user's model routing. The final evidence reran with a disposable HOME and
  passed every check; the diagnostic failure is retained but not counted.
