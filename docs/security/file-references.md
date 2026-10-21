# File references (`{file:...}`)

OpenCode's config lets any string value carry a `{file:/path}` placeholder, which OpenCode replaces
with the file's contents before the value is used. `omo setup` imports an OpenCode config, so it
resolves those placeholders too: the engine cannot read files, so the bytes that land in
`auth.json`, `models.json` and `mcp.json` are the literal secret.

Before this change, any absolute path on the machine resolved. A config file is a file, and a config
file can arrive from somewhere the user did not write, so a `{file:...}` reference was a way to make
setup copy an arbitrary file into a file the engine reads at startup.

## What resolves now

A reference resolves only when all of these hold:

1. It is absolute, after a leading `~/` is expanded against the user's home directory. A relative
   path resolves against whatever directory `omo setup` happened to run in, which is not a stable
   answer, so it is refused.
2. It is not under a denylisted prefix (below).
3. It exists and is a regular file.
4. It is not a symlink. omo reads the file named, never what it points at.
5. Its canonical path - after every symlink in the path is resolved - is inside one of the allowlist
   roots.
6. No group or other read or write bit is set on it. A secret any local user can read is a secret
   the reference has just handed out.
7. It is not empty once trailing whitespace is removed.

Otherwise the reference is refused, the value carrying it is not imported, and the setup summary
names the raw reference and the reason.

## Allowlist

The default is a single root:

```jsonc
{
  "security": {
    "file_ref_allowlist_roots": ["~/.config/opencode"]
  }
}
```

A project or user can name other roots. Setting the key replaces the default rather than extending
it, so a config that names one root gets exactly that root:

```jsonc
{
  "security": {
    "file_ref_allowlist_roots": ["~/.config/opencode", "/srv/omo-secrets"]
  }
}
```

Each entry is an absolute path, or one starting with `~/`. A relative entry is a config error: it
would mean a different directory on every machine, and on every run.

## Denylist

These prefixes are never readable through a `{file:...}` reference, and no
`file_ref_allowlist_roots` entry widens them:

| Prefix | Why |
|---|---|
| `/proc`, `/sys`, `/dev` | pseudo-filesystems that hand out another process's environment and its kernel state |
| `/etc/shadow` | the password database |
| `~/.ssh` | private keys and `authorized_keys` |
| `~/.gnupg` | the keyring |
| `~/.aws` | cloud credentials |

The denylist is checked against the path as written and again against the canonical path, so a
symlinked parent directory does not reach one of these.

## Refusal reasons

The `file refs` line of the setup summary, and the `file-refs-refused` line of
`omo setup --dry-run`, carry one of:

| Reason | What it means |
|---|---|
| `denied` | a denylisted prefix |
| `outside_allowlist` | not under any root in `security.file_ref_allowlist_roots`, including every relative and non-absolute reference |
| `symlink` | the path is a symlink |
| `too_permissive` | a group or other read or write bit is set |
| `missing` | nothing readable is there: no such file, a directory, a device, or a file holding only whitespace |

A resolved reference is reported too, with the canonical path that was read, so a summary names the
file whose plaintext is about to land in a config.

## Migrating

If setup refuses a reference you expected to resolve, do one of:

- Move the secret under `~/.config/opencode/` (conventionally `~/.config/opencode/secrets/`) and
  `chmod 600` it. This is the shipped default and needs no config.
- Add the directory that already holds it to `security.file_ref_allowlist_roots`, remembering that
  the key replaces the default.
- Replace the `{file:...}` with an environment variable, `{env:NAME}` or the engine's `${NAME}`.

Running `omo setup --dry-run` prints the canonical path of every reference that resolved and the
reason for every one that did not, before anything is written.

## Why this is not a breaking change you cannot see

`omo setup` never read a file outside the roots without saying so: a reference it could not resolve
was already refused with a notice, and one it could resolve was inlined. The change is that the
second case now needs the file to be inside the allowlist and unreadable by anyone else. A user
keeping a secret in, say, `~/.secrets/` sees the key stop importing on the next setup, with the
reason and the fix in the summary. That is the point of the change, and the migration above is the
way through it.