# The publish payload gate cannot run on Windows

## What was tested

`node script/verify-npm-payload.mjs` on Windows 11, Node 26.1.0, npm 12.0.2, plus the extracted
platform branch.

## What was observed

| Input | Before | After |
| --- | --- | --- |
| `node script/verify-npm-payload.mjs` on Windows | `Error: spawnSync npm ENOENT`, exit 1 (`red-windows.log`) | reaches npm; the run now stops at the npm 12 pack shape, which is PR #7840's defect (`green-windows.log`) |
| the same run with #7840's reader also applied | dies before npm | `npm payload containment OK (1259 packed paths, 0 offenders)`, exit 0 (`combined-windows.log`) |
| `bun test script/npm-invocation.test.ts` | file did not exist | 2 pass / 0 fail |
| mutation: `npmSpawnOptions` always returns `{}` | - | 1 of 2 tests fails, green again on revert |
| `bun test script/npm-invocation.test.ts script/npm-payload-containment.test.ts` | - | 7 pass / 0 fail |

## Why it is enough

The RED and GREEN are the real script on the platform that breaks it, and the failure mode moves from
"npm was never spawned" to "npm ran and returned a shape this branch does not read yet", which is the
exact boundary of this change. The combined run shows the end state once #7840 lands.

## What was omitted

`shell: true` makes Node print DEP0190 about argument escaping. The arguments here are four fixed
literals with no interpolation, and `.cmd` cannot be spawned without a shell since the Node
argument-injection fix, so the warning is accepted rather than worked around. No secrets appear in the
logs.
