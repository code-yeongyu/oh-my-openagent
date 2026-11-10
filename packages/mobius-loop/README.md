# mobius-loop

An agent skill for outcome-driven work. It walks an agent through the Open
Practice Library Mobius Loop (Discover, Decide, Deliver, with Foundation
underneath) and keeps each initiative as a durable, revisioned record in the
project. A pivot keeps earlier options and evidence. Passing delivery checks
never count as measured user impact.

The package is the skill directory plus the small Node engine it imports. It
has no extension, hooks, CLI, public SDK export, or runtime dependencies.

## Status

Version 0.1.0 is private and unpublished. This optional package lives at
`packages/mobius-loop` and is installed explicitly from a local path. It is
outside the root workspace, root npm payload, default skill discovery and
adapter staging. It has no default loader wiring or install lifecycle.
Registry ownership and publication are not configured; the registry name
`mobius-loop` is provisional.

The implementation was ported from the standalone package at revision
`e4179feda989313cf6453ce46870fa0e76b96701`. Runtime, declaration, skill,
reference and development configuration bytes are preserved. The artifact
consumer imports its event type through the engine's declaration boundary.
This README, [NOTICE.md](NOTICE.md) and the release guide are adapted for local
monorepo use while preserving the original source and license provenance.
This opt-in proposal does not establish maintainer acceptance.

Historical standalone-package QA covered:

- Tarball installation and the installed engine on macOS ARM64 and Windows
  Server 2025 x64 with Node 24.22.2 (`engines.node` is `>=24.22.2`), including
  separate-process resume, revision conflicts, evidence rules, unsafe storage
  and interrupted writes.
- Skill discovery, collision diagnostics and package filtering through Senpi's
  resource loader: 2026.11.5-1 on macOS and 2026.11.6-3 on Windows.
- OmO Native 5.1.65 on macOS and Windows Server 2025: installation,
  `/skill:mobius-loop` activation, record mutation, session restart, a real
  delivery-goal reference and the memory handoff, driven by a scripted provider
  through real host tools. Local-path updates and removal preserve records.

Those historical runs used the standalone delivery tree. They do not establish
that this monorepo package passed a new host run. The retired Windows VM was
not used to test this port; its evidence applies only to the identical runtime
and the recorded host versions. The scripted provider exercised integration,
not autonomous model behavior or user impact. Registry installation, other
agent hosts and an autonomous workflow remain untested.
[docs/releasing.md](docs/releasing.md) lists the local verification steps.
No package-specific CI or release workflow is configured in this port.

## Install in OmO Native

From the monorepo root, install the package explicitly:

```sh
omo install "$(pwd)/packages/mobius-loop"
omo list
```

The host records that absolute path in its settings and loads the skill from
there. It doesn't copy the files. Keep the checkout at that location while it
is installed. Runtime use requires Node 24.22.2 or later and no dependency
installation.

For a copy independent of the checkout, build and unpack a local tarball.
Run these commands from the monorepo root with Bun 1.4.4 and Node 24.22.2:

```sh
cd packages/mobius-loop
bun install --frozen-lockfile
bun run check
mkdir -p /tmp/mobius-pack
bun pm pack --destination /tmp/mobius-pack
mkdir -p "$HOME/.local/share/mobius-loop/0.1.0"
tar -xzf /tmp/mobius-pack/mobius-loop-0.1.0.tgz \
  -C "$HOME/.local/share/mobius-loop/0.1.0" --strip-components=1
omo install "$HOME/.local/share/mobius-loop/0.1.0"
omo list
```

Any durable directory works, but pass its absolute path. `omo install -l`
writes the entry to the project's `.omo/settings.json` instead of
`~/.omo/agent/settings.json`.

## Use

Invoke the skill with `/skill:mobius-loop`, optionally followed by an
initiative or slug to resume. The agent can also pick it up on its own from the
skill description. Don't count on a bare `/mobius-loop` alias; OmO creates
those only for its bundled skills.

Each initiative lives in `.omo/mobius/<slug>/initiative.json` in the project,
next to a `.gitignore` that keeps the store out of git. The engine writes
nothing else. Records from the earlier Mobius feature checkout stay readable,
because the path and schema haven't changed.

Two integrations are optional. With `ulw-loop` available, an experiment can
link to its delivery goal. With a memory tool available, the agent can save a
lesson; `learning()` returns the lesson as data and never writes memory
itself. Without either, the skill still records the whole initiative.

[skills/mobius-loop/SKILL.md](skills/mobius-loop/SKILL.md) is the agent-facing
workflow, and [references/omo-native.md](skills/mobius-loop/references/omo-native.md)
has the OmO Native details.

## Duplicate copies

A feature checkout of OmO may bundle its own `mobius-loop`. When two skills share
a name, the host warns and keeps the first one it finds. Disable or remove the
copy you don't want, then check which path loaded: the skill location shown to
the agent, or `moduleUrl` from `mobius.help()`, should sit inside your unpacked
directory.

OMO's `disabled_skills` setting may not filter skills that come from an
external package. To turn this package's skill off without removing it, swap
its string entry under `packages` in the settings file for an object:

```json
{
  "packages": [
    { "source": "/absolute/path/to/unpacked/package", "skills": [] }
  ]
}
```

`omo config` opens the same resource toggles in a TUI.

## Update and remove

To move to another local build, unpack it into a new directory, install that
path, and remove the old one. For a checkout install, changes at the installed
path take effect when the host reloads its resources.

```sh
omo remove "$HOME/.local/share/mobius-loop/0.1.0"
```

Removing the package only drops it from settings. Project initiatives under
`.omo/mobius/` stay where they are, and so does the unpacked directory, which
you can delete afterwards.

## Other hosts

The skill follows the [Agent Skills](https://agentskills.io/specification)
directory layout, and the engine needs only Node built-ins. A host that loads
skills and lets the agent import a local ES module in a persistent JavaScript
runtime might work. No such host has been tested.

## Development

Bun 1.4.4 is the development toolchain. Run these commands from the monorepo
root; the package keeps its own lockfile and development dependencies.

```sh
cd packages/mobius-loop
bun install --frozen-lockfile
bun run check
```

`check` runs type checking, lint, package validation, and the tests. The tests
under `skills/mobius-loop/scripts/` stay out of the tarball.

## License

See [NOTICE.md](NOTICE.md) for provenance, modifications, and how the licenses
apply. [LICENSE.md](LICENSE.md) holds the full Sustainable Use License 1.0.
`skills/mobius-loop/references/model.md` carries its own CC BY-SA 4.0
attribution.
