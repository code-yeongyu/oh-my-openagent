WHAT TESTED
- Before-fix synthetic-load reproduction: temporarily removed the publication-aware predicate, launched 40 parallel `yes > /dev/null` generators, and ran `bun test packages/omo-senpi/src/components/memory/worker/spawn-supervisor.test.ts`. Exit 1: the authority test failed with `memory run supervisor exited with 1`; the other three tests passed. Load cleanup returned no `yes` processes.
- Deterministic RED proof: the same old predicate fails against a fixture that writes `publishing.json` and a matching `outcome.json`, then exits before deleting `launch.json`; this isolates the publication-order race. The initial 20-run loaded batch did not reproduce without this direct race fixture.
- After-fix loaded verification: launched 40 parallel `yes > /dev/null` generators and ran the target file 10 times concurrently. All ten exited 0 and each reported 4 pass / 0 fail.
- Cleanup: killed all load-generator PIDs and checked `pgrep -fl '(^|/)yes( |$)'`; no output.

OBSERVED
- The production publication path writes `publishing.json`, then the durable matching `outcome.json`, then later removes `launch.json`.
- The parent previously rejected a matching outcome whenever `launch.json` still existed. If the supervisor closed/crashed in that interval, the parent reported the supervisor exit instead of honoring the already-published outcome.
- The RED proof failed only the outcome-authority test and retained the incomplete-outcome rejection, isolating the race to the parent authority predicate.
- The fix accepts a matching outcome with a surviving launch marker only when the publication marker also exists.

WHY ENOUGH
- The proof uses the real `runReflectionChild` production path and real child-process fixture, and distinguishes an in-flight publication from an outcome fabricated before publication.
- The loaded post-fix capture is 10/10, with the same synthetic CPU-load shape requested for the repro.
- The target test file, complete worker directory, and TypeScript checks are run separately and recorded in the PR QA section.

OMITTED
- No fixed sleeps or retry loops were added. Existing bounded event/state waits remain the synchronization mechanism.
- The exact reported host-load flake did not reproduce in the initial 20-run batch; the deterministic publication-order RED proof is included instead because it exercises the identified race directly.
