# The payload verifier reads only npm 11's pack --json shape

## What was tested

`script/verify-npm-payload.mjs`, the gate `publish.yml` runs before every `npm publish`, against
real `npm pack --dry-run --json` output produced by npm 12.0.2 on this machine (1222 packed paths).

## What was observed

`red-npm12.log`, both readers on the same real npm 12 payload:

```
old reader THROWS: TypeError: parsed is not iterable
new reader -> 1222 paths
new reader first path: .agents/command/get-unpublished-changes.md
```

| Input | Before | After |
| --- | --- | --- |
| real npm 12 `pack --json` output | `TypeError: parsed is not iterable` | 1222 paths, identical to the npm 11 shape |
| npm 11 array output | 2 paths | 2 paths (unchanged) |
| output of neither shape (`[]`, `{}`, `null`, a result without `files`) | read of undefined | `Error: npm pack --json returned no packed file list` |
| whole verifier end to end on the npm 12 payload | could not reach the checks | `npm payload containment OK (1222 packed paths, 0 offenders)`, exit 0 |

Unit run: `green-unit.log`, 3 pass / 0 fail. Verifier run: `green-verifier.log`.

## Why it is enough

The RED is real registry-tool output from this repository, not a synthetic fixture, and the GREEN
run drives the actual script rather than the extracted helper. Severity is forward-looking: CI and
`publish.yml` pin Node 24 (npm 11) today, so this is the gate breaking the day that pin moves, plus
a named error instead of a read-of-undefined for any other shape.

## What was omitted

The end-to-end verifier run substitutes the `npm pack` spawn with the saved npm 12 payload for the
duration of that one run, because `execFileSync("npm", ...)` cannot resolve `npm.cmd` on Windows
without a shell (`spawnSync npm ENOENT`). That Windows spawn gap is a separate defect and is not
fixed here. The substitution was reverted with `git checkout --` immediately after the capture; the
committed script still spawns npm. No secrets appear in the logs.
