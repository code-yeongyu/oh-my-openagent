# OmO Native geoip enrichment evidence

## Decision

Removed the OmO Native `disableGeoip: true` override and relaxed the factory return type to `TelemetryProductConfig`. This is preferable to explicitly setting `false` because all four configs now use the same effective shared-client default:

```ts
disableGeoip: input.product.disableGeoip ?? false
```

The legacy adapters omit the property, so OmO Native now matches them exactly. `$process_person_profile`, event names, distinct ids, shared properties, opt-out behavior, and key resolution were not changed.

## RED

The pinning assertion was changed before production code from `true` to the effective shared-client value `config.disableGeoip ?? false`.

Command:

```sh
bun test packages/omo-senpi/src/components/telemetry/product-identity.test.ts
```

Output against the old native config:

```text
Expected: false
Received: true

      at <anonymous> (packages/omo-senpi/src/components/telemetry/product-identity.test.ts:49:42)
(fail) OmO Native product identity > #given the native product #when config is created #then identity derivation and geoip settings are fixed

 7 pass
 1 fail
 135 expect() calls
Ran 8 tests across 1 file.
```

This proves the new assertion fails against the previous `disableGeoip: true` value.

## GREEN

After removing the override:

```sh
bun test packages/omo-senpi/src/components/telemetry/product-identity.test.ts
```

```text
(pass) OmO Native product identity > #given the native product #when config is created #then identity derivation and effective geoip settings are fixed

 8 pass
 0 fail
 136 expect() calls
Ran 8 tests across 1 file.
```

Full telemetry directory:

```sh
bun test packages/omo-senpi/src/components/telemetry
```

```text
 82 pass
 0 fail
 325 expect() calls
Ran 82 tests across 11 files. [1339.00ms]
```

Test-count receipt: the `origin/dev` telemetry directory also ran 82 tests. Its run exposed a pre-existing stale unconfigured-key fixture, with 81 pass and 1 fail, because the fixture no longer explicitly supplied the unconfigured sentinel after the shipped native key became configured. The fixture was corrected to provide `UNCONFIGURED_POSTHOG_API_KEY`; no production key resolution changed. Test count remained 82 to 82.

## Four-config probe

Temporary probe command, run from the worktree root:

```sh
bun ./qa-geoip-probe.ts
```

Real stdout:

```text
opencode: disableGeoip=false geoip=ON
codex: disableGeoip=false geoip=ON
senpi-legacy: disableGeoip=false geoip=ON
omo-native: disableGeoip=false geoip=ON
```

Each value is the effective value computed as `config.disableGeoip ?? false`.

## Documentation drift

Only prose outside the generated schema sentinels changed. The generated block comparison printed:

```text
generated-schema-block-byte-unchanged=true
```

Command:

```sh
bun test packages/omo-senpi/src/components/telemetry/schema-doc.test.ts
```

```text
 2 pass
 0 fail
 1 expect() calls
Ran 2 tests across 1 file. [1088.00ms]
```

## Typecheck

Command:

```sh
bun run --cwd packages/omo-senpi typecheck
```

Output:

```text
$ tsgo --noEmit -p tsconfig.json
```

Exit status: 0.

## Rebuilt artifacts and bundle gates

Build and stale-output check:

```sh
node packages/omo-senpi/plugin/scripts/build-extension.mjs
node packages/omo-senpi/plugin/scripts/build-extension.mjs --check
```

Relevant output:

```text
Built omo-senpi extensions: packages/omo-senpi/plugin/extensions/omo.js, packages/omo-senpi/plugin/extensions/omo-member.js
omo-senpi extension build is current: packages/omo-senpi/plugin/extensions/omo.js
```

The build regenerated all three JavaScript artifacts:

```text
packages/omo-senpi/plugin/extensions/omo.js 896117
packages/omo-senpi/plugin/extensions/omo-member.js 117729
packages/omo-senpi/plugin/extensions/omo-memory-mcp.js 50687
```

Measured main bundle size: **896,117 bytes**. Budget: **900,000 bytes**. Remaining headroom: **3,883 bytes**.

Built-artifact probe:

```text
old-native-disable-override-present=false
cacheDirName:"omo-native",defaultApiKey:B5,defaultHost:oo,eventName:"daily_active",machineIdPrefix:"omo-senpi:",packageName:"@oh-my-opencode/omo-senpi",packageVersion:H5,platform:"omo-senpi",productEnvPrefix:"OMO_SENPI",productName:"omo-native"
```

Bundle gate command:

```sh
bun test packages/omo-senpi/src/bundle-size.test.ts packages/omo-senpi/src/bundle-purity.test.ts
```

```text
 3 pass
 0 fail
 5 expect() calls
Ran 3 tests across 2 files. [112.00ms]
```

## Legacy adapter integrity

Command:

```sh
git diff --exit-code -- \
  packages/omo-opencode/src/shared/telemetry-product-identity.ts \
  packages/omo-codex/src/telemetry/product-identity.ts \
  packages/omo-senpi/src/components/telemetry/index.ts \
  && echo 'legacy configs byte-unchanged: yes'
```

Stdout:

```text
legacy configs byte-unchanged: yes
```

## Cleanup receipt

The temporary probe was deleted after capture:

```text
cleanup: qa-geoip-probe.ts removed
```

`git status` contains no `qa-geoip-probe.ts` entry.
