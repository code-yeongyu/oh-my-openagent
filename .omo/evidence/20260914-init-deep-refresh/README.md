# Init-deep refresh evidence

## What was tested

- Measured tracked source after excluding vendored, generated, evidence, binary, minified, and lockfile content.
- Partitioned 41,593,695 source bytes into 105 approximately 400 KiB scanner chunks.
- Validated every generated scanner report for the required seven headers and the 5,000-token bound.
- Scored top-level directories and checked that every qualifying domain already had a local guide.
- Replaced the root guide with a 101-line reducer summary and preserved nested authoritative guides.
- Verified snapshot fields against the current Git HEAD and tracked inventory.

## What was observed

- Sizing result: 39.67 MiB, `N_quick=102` by formula; contiguous whole-file bin packing produced 105 bounded chunks because oversized files cannot be split safely.
- Remote DAG and task providers returned provider-level `403 Request not allowed` or connection errors before tool use. No remote claim was trusted and no remote artifact was accepted.
- A deterministic local extraction fallback produced 105 reports. The first validation found one heading collision in chunk 067; after repair, validation reported `PASS reports=105 digests=19`.
- Root `AGENTS.md` contains 101 lines, within the required 50-150 range.
- After restoring the compact development-environment contract, root `AGENTS.md` contains 109 lines, still within the required range.
- Top-level scoring found no uncovered directory above the creation threshold; existing child guides were retained rather than duplicated.
- Snapshot: commit `cfdaa1d16d25d6152410dea514fd978acfd62bab`, 10,884 tracked files, 1,073,426 filtered source lines, committed mode.
- Focused verification passed: `bun test script/agents-md-dev-env.test.ts packages/omo-opencode/src/shared/markdown-link-audit.test.ts` reported 20 pass, 0 fail.
- The canonical setup installed dependencies and initialized submodules, then its optional build failed under local Bun 1.3.14 / Node 22 while the repository expects Bun 1.4.2 / Node 24. The failure was in pre-existing TypeScript declaration errors outside the documentation diff.
- The mandatory gate reviewer and one smaller retry both failed at the provider boundary with connection errors and produced no verdict. The review lane is recorded as `INCONCLUSIVE`; no success claim from either reviewer was accepted.

## Why it is enough

The map covered every included source file, the reduction retained the existing deep hierarchy, and mechanical validation checks the report schema, root size, qualifying top-level coverage, and snapshot inventory. Focused repository tests cover the development-environment contract and all checked-in Markdown links. This is a documentation-only change, so runtime harness QA is not applicable; the remaining regression risk is stale prose, addressed by direct review against the live inventory and PR review.

## What was omitted

Raw scanner reports and digests are ephemeral and removed after verification. Provider transcripts contain no useful repository facts and are summarized rather than copied. No credentials, environment dumps, tokens, or auth headers are recorded.
