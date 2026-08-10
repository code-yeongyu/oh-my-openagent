# Task 5 evidence

## RED

Command:

```sh
cd /Volumes/mengmotaStorage/local-workspaces/omo-wt/feat/omo-native-telemetry && bun test packages/omo-senpi/src/components/telemetry/product-identity.test.ts
```

Result before `product-identity.ts` existed:

```text
bun test v1.4.0-canary.1 (b58cd4685)

packages/omo-senpi/src/components/telemetry/product-identity.test.ts:

# Unhandled error between tests
-------------------------------
error: Cannot find module './product-identity' from '/Volumes/mengmotaStorage/local-workspaces/omo-wt/feat/omo-native-telemetry/packages/omo-senpi/src/components/telemetry/product-identity.test.ts'
-------------------------------

 0 pass
 1 fail
 1 error
Ran 1 test across 1 file. [94.00ms]

EXIT_STATUS=1
```

## Runtime skills root finding

The staged package layout was inspected before freezing the skill names:

```text
packages/omo-senpi/plugin/extensions/omo.js
packages/omo-senpi/plugin/skills/<skill-name>/SKILL.md
```

At runtime `import.meta.url` is the installed `plugin/extensions/omo.js` bundle URL. Therefore `new URL("../skills/", import.meta.url)` resolves to the packaged `plugin/skills/` directory. The source-only path in `skills-sync.test.ts` is a repository test fixture path, not the runtime derivation. `BUILTIN_SKILL_NAMES` was frozen from the 21 packaged directory names and `skills-sync.test.ts` now compares the static constant to that directory exactly.

## GREEN

Required suite:

```sh
cd /Volumes/mengmotaStorage/local-workspaces/omo-wt/feat/omo-native-telemetry && bun test packages/omo-senpi/src/components/telemetry packages/omo-senpi/src/skills-sync.test.ts
```

Result:

```text
28 pass
0 fail
243 expect() calls
Ran 28 tests across 4 files. [1.85s]
EXIT_STATUS=0
```

The count is accountable: the prior selected surfaces contained 19 tests, and task 5 adds 8 co-located identity tests plus 1 additive packaged-skills assertion, for 28 total.

Typecheck:

```sh
cd /Volumes/mengmotaStorage/local-workspaces/omo-wt/feat/omo-native-telemetry && bun run --cwd packages/omo-senpi typecheck
```

```text
$ tsgo --noEmit -p tsconfig.json
EXIT_STATUS=0
```

## Manual QA

Literal command:

```sh
cat > /tmp/omo-native-task5-qa.ts <<'EOF'
import {
  BUILTIN_SKILL_NAMES,
  getOmoNativeStateDir,
  hashSessionId,
} from "/Volumes/mengmotaStorage/local-workspaces/omo-wt/feat/omo-native-telemetry/packages/omo-senpi/src/components/telemetry/product-identity.ts"

console.log(`stateDir=${getOmoNativeStateDir()}`)
console.log(`hash1=${hashSessionId("abc")}`)
console.log(`hash2=${hashSessionId("abc")}`)
console.log(`skills=${BUILTIN_SKILL_NAMES.length}`)
console.log(`first5=${BUILTIN_SKILL_NAMES.slice(0, 5).join(",")}`)
EOF
rm -rf /tmp/omo-native-task5-agent
SENPI_CODING_AGENT_DIR=/tmp/omo-native-task5-agent bun /tmp/omo-native-task5-qa.ts
```

Real stdout:

```text
stateDir=/tmp/omo-native-task5-agent/omo-senpi/omo-native
hash1=e8136eafd36c34eb1bf7de8b94c1afdae64cb0c781ed9049355f575ccecd0a6a
hash2=e8136eafd36c34eb1bf7de8b94c1afdae64cb0c781ed9049355f575ccecd0a6a
skills=21
first5=ast-grep,coding-agent-sessions,data-scientist,debugging,frontend
```

Cross-process persisted-salt check:

```text
process1=1cb65287414be376eec3cca4736e235ad837c996e3cd59ff31d4002ff26bea67
process2=1cb65287414be376eec3cca4736e235ad837c996e3cd59ff31d4002ff26bea67
stable=true
```

## Adversarial results

- Empty or whitespace `SENPI_CODING_AGENT_DIR` is rejected by the existing `resolveAgentHome` boundary and falls back to the established agent-home resolution.
- Missing salt: the test deletes `session-id-salt`; the next hash call recreates it and does not throw.
- Unwritable state path: with `SENPI_CODING_AGENT_DIR=/dev/null`, hashing does not throw and a process-local random fallback salt keeps repeated hashes stable.
- Stale state: two separate Bun processes using the same state directory produced the same hash, proving persisted salt reuse across module instances.
- Independent masking: a known provider plus an unknown user-defined model preserves the provider and masks only `model_id`; an unknown provider masks both fields independently.
- Static inventory drift: curated agents and builtin categories are equality-tested against the imported senpi-task sources; skill names are equality-tested against the packaged directory.

## Cleanup receipt

Removed `/tmp/omo-native-task5-qa.ts`, `/tmp/omo-native-task5-agent`, and captured temporary output files after recording the evidence. The ignored worktree `plugin/skills/` staging output was retained so the required skills-sync verification remains directly rerunnable. No salt, hostname, or payload file was added to git.
