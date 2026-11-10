# OmO Native and Senpi host guide

Host-specific steps for running this skill in OmO Native or Senpi. The workflow,
records, and evidence rules in [the skill](../SKILL.md) are unchanged.

## Load the engine

The host lists skill locations with an `rN/` prefix, such as
`r2/mobius-loop/SKILL.md`. Expand the prefix through the matching
`<skill_roots>` entry and drop `/SKILL.md` to get the absolute `skillRoot`.
Use that path as it is, whether it points into a bundled directory or an
external package directory.

Run the engine in a `js` `eval` cell. Its kernel keeps `mobius` bound across
cells; `print` shows a result.

```js
const { join } = await import("node:path")
const { pathToFileURL } = await import("node:url")
const { createMobius } = await import(pathToFileURL(join(skillRoot, "scripts", "mobius.mjs")).href)
const mobius = createMobius({ cwd: projectDirectory, slug: "install-diagnosis" })
print(await mobius.status())
```

The file URL handles Windows drive paths as well as POSIX paths.
`projectDirectory` is the session's absolute project directory. After a kernel
restart, `mobius` is undefined: import again with the same `skillRoot`,
directory, and slug, then call `status()`.

## Confirm the selected copy

Another skill named `mobius-loop`, such as one bundled by an OmO feature
checkout, can coexist with this package. The host warns about the collision and
keeps the first copy found. Before the first mutation in a session, check that
`(await mobius.help()).result.moduleUrl` points inside the expected
`skillRoot`. Convert the file URL to a filesystem path and resolve both paths
through `realpath` before comparing them: macOS `/var` and `/private/var` can
name the same directory. When the canonical paths differ, tell the user which
copy loaded so they can disable or remove the other one.

## Link a ulw-loop delivery

`ulw-loop` is optional. Read the loaded `ulw-loop` skill before using its SDK,
and let it own goals, evidence, and checkpoints. After it creates goals, record
its session id (`status().result.binding.sessionId` from that SDK) and the real
goal id in the Mobius experiment:

```js
deliveryRef: { kind: "ulw-loop", sessionId, goalId }
```

The link records where delivery runs. Mobius doesn't create, complete, or edit
the goal. When `ulw-loop` isn't loaded, omit `deliveryRef`.

## Save a lesson to memory

The `memory` tool is optional. Pass `result.description` and `result.body` from
`learning()` with `source: "agent"` and a project-scoped path. Record a user
decision only under the memory tool's own rules for user provenance. Mobius
never calls the memory tool itself.
