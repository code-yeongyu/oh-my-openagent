# auth.json at-rest encryption

`auth.json` holds the API keys omo (omo-ai, the native edition) uses to call
provider APIs. On disk it lives at `<agentDir>/auth.json` and is the only file
with raw credentials that omo writes outside its SQLite state. This document
describes how omo protects the file when at-rest encryption is on, and the
trade-offs of each mode.

## Modes

Set `security.auth_at_rest` in `omo.json` to one of:

| Mode         | Default | Encrypted? | What you must do per `omo` invocation |
|--------------|---------|------------|----------------------------------------|
| `plain`      | yes     | no         | nothing                                |
| `passphrase` | opt-in  | yes        | provide the passphrase (env or prompt) |
| `ssh-key`    | opt-in  | yes        | keep your ssh key on disk              |

`plain` is the historical default. PR-E marks it **deprecated** and schedules
a follow-up "sunset" PR six months from this release that flips the default.
A user who never sets `security.auth_at_rest` sees no behavior change today.

Once a non-`plain` mode is set, every write to `auth.json` produces an
AES-256-GCM-encrypted envelope (`version`, `mode`, `salt`, `nonce`, `tag`,
`ciphertext`, optional `sshFingerprint`). The previous plain JSON is kept as a
timestamped `.bak-<ts>` (the same backup the legacy writer produces), and the
next save replaces it.

## Operational impact

- **Plain users**: nothing changes. The launcher reads and writes the same
  JSON, mode `0600`. The on-disk file contains the keys.
- **Passphrase users**: you must provide the passphrase each `omo`
  invocation. The launcher reads `OMO_AUTH_PASSPHRASE` from the environment
  first, then prompts (TTY only) if that is unset. The passphrase is held in
  process memory; it is never persisted by omo. A process without the
  passphrase cannot decrypt `auth.json`.
- **SSH-key users**: omo derives the key from `~/.ssh/id_ed25519` (default;
  override via `security.ssh_key_path`). No second secret is required. If the
  file is missing, the read fails closed.

## Migration

Reading a plaintext `auth.json` while the configured mode is `passphrase` or
`ssh-key` succeeds: omo hands the entries back as if they were still plain.
The next `writeAuthStore` produces an encrypted envelope. No copy step is
required; the `.bak-<ts>` is the only side effect. The launcher surfaces the
upgrade in the `omo setup` summary and `omo doctor`.

`omo setup` lists the current mode under the credential stage and notes any
unencrypted legacy credentials. `omo doctor` prints one `INFO auth-at-rest`
line naming the in-effect mode.

## First-run prompt

When `auth.json` already contains entries, the configured mode is `plain`,
and stdin is a TTY, the launcher prints:

```
omo: auth.json is plain. encrypt at rest with ssh-key? [y/N]
```

The recommended default is `ssh-key` when `~/.ssh/id_ed25519` (or another
candidate) is on disk, `passphrase` otherwise. Pressing `y` writes the choice
to `~/.omo/state/auth-at-rest-mode.json` (mode `0600`); the launch then
proceeds without blocking.

The prompt is non-blocking: pressing Enter leaves the user on `plain` and
the engine spawns as usual. The prompt never returns once a sticky choice is
set.

## Failure modes

- Wrong passphrase: the read returns `{ entries: undefined, error }`. The
  launcher refuses to spawn the engine with a clear `auth.json is encrypted,
  could not decrypt: <reason>` message; `omo setup` reports the same in its
  summary lines so the user can set the right `OMO_AUTH_PASSPHRASE`.
- Wrong or moved ssh key: the read fails closed the same way. The user can
  add `security.ssh_key_path` in `omo.json` to point at the new location.
- Tampered envelope: AES-GCM detects any modification via the auth tag; the
  read rejects with the same closed failure as a wrong key.
- Missing state file under the configured mode: a hand-edited or removed
  `~/.omo/state/auth-at-rest-mode.json` falls back to the configured
  `security.auth_at_rest` in `omo.json`, then `plain`.

## What is NOT in scope for PR-E

- Encryption of `<agentDir>/models.json` or other state files. Only
  `auth.json` is touched.
- A key-rotation helper. The next save overwrites the previous envelope; the
  `.bak-<ts>` file is the only recovery path.
- A sunset of `plain` itself. That is the follow-up PR scheduled in the
  2026q4 security roadmap.
