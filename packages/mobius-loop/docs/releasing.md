# Local package verification

This optional package remains version 0.1.0, private and unpublished. It is
installed explicitly from a local path and stays outside root workspace
registration, root npm files, default skill discovery and adapter staging.
No package-specific CI, release workflow or registry publish job is configured.
The standalone package's workflows are not part of this port.

## Build a local candidate

Run from the monorepo root with Bun 1.4.4 and Node 24.22.2:

```sh
cd packages/mobius-loop
bun install --frozen-lockfile
bun run check
mkdir -p artifacts
bun pm pack --destination artifacts
```

The package uses its own lockfile and development configuration. Keep its
checks independent of the root dependency graph. The candidate is
`artifacts/mobius-loop-0.1.0.tgz`; unpack it into a durable directory outside
the checkout before installation. See [the README](../README.md) for commands.

## Verify the candidate

Run these against the packed tarball, unpacked outside the source checkout,
never against the working tree.

1. The file list holds only `package.json`, `README.md`, `LICENSE.md`,
   `NOTICE.md`, `docs/releasing.md`, `skills/mobius-loop/SKILL.md`, the four
   references under `skills/mobius-loop/references/`, and the six runtime
   `.mjs` and two `.d.mts` files under `skills/mobius-loop/scripts/`.
   No tests, workspace links, or developer paths.
2. From `packages/mobius-loop`, `bun script/validate.ts <unpacked-dir>` passes.
3. The unpacked engine imports under plain Node at the minimum supported
   version, finds its own files by relative path, and creates and resumes an
   initiative across two processes.
4. In an isolated OmO Native home, `omo install <unpacked-dir>` succeeds, the
   skill is discovered from that directory, and `/skill:mobius-loop` records and
   resumes a real initiative after a restart. Exercise a `ulw-loop` link and the
   learning handoff, then confirm `omo remove` leaves `.omo/mobius/` intact.
5. With a same-name copy also present, the collision warning appears, the
   object entry with `"skills": []` disables this package, and the selected
   path is the expected one.
6. Record the exact platform, runtime and host versions exercised, the
   isolation proof, and startup and shutdown warnings. Report omissions
   explicitly. These runs do not certify the host's background services,
   autonomous model behavior or user impact.

The existing tests include installed-artifact consumers, missing-runtime and
missing-release-guide RED/GREEN checks, separate-process resume and interrupted
writes. Keep them intact and run the relevant repository gates as well.

## Historical evidence

Before this port, the standalone delivery tree was exercised on macOS ARM64
and Windows Server 2025 x64 with Node 24.22.2. Historical host journeys used
OmO Native 5.1.65 on both platforms; resource-loader checks used Senpi
2026.11.5-1 on macOS and 2026.11.6-3 on Windows. A scripted provider drove real
host tools. These are historical integration results, not a new run against
this monorepo tree or evidence of autonomous model behavior. The Windows VM
is retired; retain its evidence only for byte-identical runtime behavior at
those recorded versions, without claiming the port was tested there.

## Version and publication boundary

Retain `private: true`, version 0.1.0 and the independent package lockfile.
Records keep `schemaVersion: 1`. Changing the storage path or the
`deliveryRef` union needs its own tested migration.

Registry publication is not configured. Ownership, package name, license
metadata, publishing identity and a verified distribution process require a
separate decision and change. This guide describes local packaging and
installation only.
