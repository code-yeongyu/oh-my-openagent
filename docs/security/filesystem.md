# Filesystem modes under `~/.omo`

`~/.omo` is omo's home. It holds credentials, session transcripts, memory
repositories, task records and team mailboxes, so every directory in it belongs
to one account and nobody else. This page records which mode each path gets and
why, so a reviewer can tell an intentional mode from an oversight.

## The rule

| Path | Mode | Why |
|------|------|-----|
| `~/.omo` | `0700` | The tree root. Every path below it is only as private as this is. |
| `~/.omo/<any subdirectory>` | `0700` | Inherited from the root: a directory reachable through a world-readable parent is not private. |
| A file inside `~/.omo` | writer's choice (today `0644`) | Files are a separate concern; see "Not in this change". |

Group and other bits (`0077`) are what "wider than 0700" means. A directory at
`0750` is still exposure: any account in the owning group can list it.

## Who enforces it

**On create.** Each store that materialises a directory under the omo home
tightens the directory it creates, not just the mode it passes to `mkdir`:

- `packages/memory-core/src/fs/private-dir.ts` - `ensurePrivateDirectory()`, used by the
  transcript journal (`src/journal/store.ts`) and the soul-notice watermark
  (`src/soul/watermark.ts`).
- `packages/senpi-task/src/store/private-dir.ts` - the task store's twin, used by
  `src/store/record-store.ts` and `src/store/record-write.ts`.

Both exist as separate modules because neither package depends on the other and
memory-core carries no workspace dependency at all. A workspace edge between the
memory engine and the task engine is a larger architectural change than this
hardening warrants; if a third package needs the same primitive, it belongs in a
shared core package and these two move with it.

`mkdir`'s `mode` alone cannot carry the contract. The kernel masks it with the
process umask, and Node skips it entirely when the directory already exists, so
a directory created by an older build at `0755` keeps `0755` forever. The
explicit `chmod` after the `mkdir` is what makes the call idempotent and what
repairs a legacy directory on the next write. Both helpers return whether they
actually tightened something, so a caller can tell a first create from a repair.

An ancestor that already exists is tightened only when this call is the one that
creates it. Repairing an existing ancestor is the migration's job, not the
store's.

**On launch.** `packages/omo-native/bin/lib/agent-dir.js` exports
`hardenOmoHomeModes()`. Every launcher run walks the canonical `~/.omo` tree and
chmods every real directory that is wider than `0700`. It is idempotent by
construction: an already-private tree is walked and changed nothing, so the cost
after the first launch is one `stat` per directory.

**In diagnostics.** `auditOmoHomeModes()` reads the same tree without touching
it, and `omo doctor` prints the result. Doctor deliberately does not repair:
a diagnostic run must not mutate the machine it is diagnosing. The launch
migration runs before doctor in the same process, so a healthy launch reads as
`PASS omo home modes: every directory under ~/.omo is 0700`, and a `FAIL` names
a directory that is still wide or that could not be read.

## What the migration refuses to do

- **Files.** A file's mode is not this change's business.
- **Symlinks.** The walk uses `readdirSync(..., { withFileTypes: true })` and
  `lstatSync`. A symlink is reported as a symlink even when it points at a
  directory, so a link inside `~/.omo` can neither be walked nor become a chmod
  target. It cannot pull a path outside the tree into the walk.
- **`~/.omo/desktop/` and `~/.omo/desktop.init-*`.** Those entries belong to the
  OmO desktop app as its own data home
  (code-yeongyu/omo-desktop-app#1829). No omo code may create, reset, archive,
  flatten, migrate, prune, copy or sync them, and a walk over the omo home is
  exactly such a traversal. They are skipped at every level, not only at the top.
- **Blocking a launch.** A directory this process cannot chmod is collected and
  reported; it never throws. `omo doctor` names it and the user fixes it.

## Not in this change

- File modes inside `~/.omo`. `auth.json` in particular is a separate roadmap
  item with its own at-rest treatment.
- An explicit migration marker. The walk is already idempotent, and a marker file
  would be a second thing to get wrong.
- Anything under a project-scoped `<project>/.omo`. The walk targets the omo
  home that `canonicalAgentDir()` resolves.