# Engine trust under a user namespace (design for senpi#5334)

Status: design, under review. Code follows only after the design review is CLEAR.

## Problem

The launcher trust stage (`packages/omo-native/trust-stage.ts`) stores certificate generations in a private trust directory (`~/.omo/engine-trust`, or a `mkdtemp` directory under `TMPDIR`). Before it trusts that directory, `ancestors()` in `trust-generation.ts` walks every parent and requires each one to be:

1. a real directory, not a symlink;
2. owned by uid 0 or by the current uid;
3. not group- or other-writable unless the sticky bit is set.

The memory reflection sandbox (`packages/omo-senpi/src/components/memory/sandbox-platform.ts`) starts the child with `bwrap --ro-bind / / --dev-bind /dev /dev --tmpfs /tmp --bind <writable dirs> ...`. bwrap creates an unprivileged user namespace that maps only the caller's uid. The kernel reports every unmapped owner, root included, as the overflow uid (`/proc/sys/kernel/overflowuid`, 65534). Inside the sandbox, `/` and `/home` fail rule 2, so no trust directory can pass. The fallback under `/tmp` walks up to the same `/`, so the child dies before it does any work.

Measured on Linux x64 with bubblewrap 0.9.0, using the sandbox's own arguments and the real `prepareTrustDirectory` from `origin/dev` at `e887cabf50`:

```
outside: uid_map "0 0 4294967295"   stat / uid 0     dev 64769 ino 2
inside:  uid_map "1000 1000 1"      stat / uid 65534 dev 64769 ino 2
inside:  stat /home uid 65534, stat $HOME uid 1000, stat /tmp uid 1000 (tmpfs, dev 46)
inside:  prepareTrustDirectory -> Error: unsafe trust ancestor
```

There are two more defects on the same path:

- The Linux sandbox passes the parent's `TMPDIR` through. When that path is outside the writable binds, it is read-only inside the sandbox, so `mkdtemp` fails with `EROFS` before `ancestors()` even runs. The macOS sandbox already sets `TMPDIR` to a writable directory.
- `~/.omo` is read-only inside the sandbox. If the directory checks passed, `prepareTrustDirectory` would accept the existing `~/.omo/engine-trust`, and the first write of a new generation would then fail with `EROFS`.

## Threat model

The trust directory decides which CA roots the engine trusts. Anyone who can replace the directory, or one of its parents, can add a root and intercept the engine's TLS traffic. The attacker we defend against is another local user who is not root, or the sandboxed child itself, with write access to some path. That attacker cannot set the engine's environment: anyone who can set it already controls `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE` and `BUN_OPTIONS`, so the environment is not a new channel. Root on the host is trusted, as it is today. Inside a user namespace the kernel hides the real owner of every unmapped inode. From inside, `/` owned by root and `/srv/mallory` owned by another user look the same: both show 65534. The child alone therefore cannot tell a safe ancestor from a hostile one, and treating 65534 as root would trust directories owned by any unmapped user. A process in the initial namespace sees the real owners, so the answer has to come from there.

## Decision: inode attestation from the launching parent

1. **Producer (the sandbox launcher, outside the namespace).** Before it wraps a command in bwrap, the Linux sandbox computes an attestation. It walks the real parents of the child's trust directory (`trustDirectory(env)`), plus `/`. For each one that passes all three rules with real owner uid 0, it records `st_dev:st_ino`. The list goes to the child as `OMO_ENGINE_TRUST_USERNS_ROOTS=<dev>:<ino>[,<dev>:<ino>...]`. The launcher first checks that it runs in the initial user namespace (`/proc/self/uid_map` is exactly `0 0 4294967295`). If it does not, it emits no attestation, because it cannot see real owners either.
2. **Consumer (`ancestors()` in the child).** An ancestor whose `stat.uid` is not 0 and not the current uid is accepted as root-owned only when all of these hold:
   - the process is in a non-initial user namespace (`/proc/self/uid_map` is readable and is not the identity map);
   - `stat.uid` equals the kernel overflow uid read from `/proc/sys/kernel/overflowuid`;
   - `${stat.dev}:${stat.ino}` is in the attestation set.

   Rules 1 and 3 still apply unchanged to every ancestor, because the mode bits are visible inside the namespace. If either `/proc` file cannot be read, nothing is relaxed. The same `ancestors()` serves `readOwnedTrustFile`, so the adopt and verify paths get the same rule and no second copy of it.
3. **Read-only trust directory.** `prepareTrustDirectory` checks that the accepted directory is writable (`fs.access(W_OK)`). If it is not, for example `EROFS`, the stage takes the existing private `mkdtemp` fallback and records a `trust-dir-readonly` diagnostic code. The sandbox never gets a writable bind into the parent's `~/.omo/engine-trust`, so a sandboxed child cannot write generations that the parent will later load.
4. **TMPDIR in the Linux sandbox.** The bwrap transform sets `TMPDIR=/tmp` for the child. That is the sandbox's fresh tmpfs, which is owned by the caller and lives only in the sandbox's mount namespace. The fallback directory is then `/tmp/omo-engine-trust-*`, with ancestors `/tmp` (owned by the caller) and `/` (attested).
5. **Unattested namespace.** In a user namespace with no matching attestation (for example, a user who wraps `omo` in their own bwrap, flatpak or rootless container), the stage refuses with a named code, `trust-userns-unattested`, and a next step, instead of crashing with an `unsafe trust ancestor` stack trace. Trust is never widened without an attestation.

### Why the attestation cannot be forged

- An inode keeps its owner and mode. Only root can `chown` a root-owned directory, and only its owner (root) can `chmod` it. An attested `dev:ino` therefore stays root-owned for as long as it exists. Rule 3 is still checked live, so a later mode change by root is still seen.
- A root-owned directory can only be removed or renamed by a writer of its parent. That parent is either attested, and so root-owned, or `/`. A non-root attacker cannot free the inode number for reuse.
- `st_dev` is assigned by the kernel per superblock. A FUSE or other user-mounted filesystem gets its own anonymous device number and cannot report the device of the root filesystem, so it cannot match an attested pair even if it chooses its inode numbers.
- Setting `OMO_ENGINE_TRUST_USERNS_ROOTS` requires control of the child's environment, which already grants control of its CA trust. The variable only relaxes the ownership rule for inodes that were really root-owned when the launcher looked at them, and for nothing else.

### What stays refused

- A directory owned by another real user: the launcher sees its real uid, so it is never attested and shows as 65534 inside, which is refused.
- A symlink anywhere in the chain, and a group- or other-writable ancestor without the sticky bit.
- Overflow-owned ancestors when the process is not in a user namespace, when the `/proc` files are unreadable, or when the overflow uid does not match.
- Any write by the sandboxed child into the parent's trust directory.

## Options considered

| Option | Verdict |
| --- | --- |
| Treat the overflow uid as root (issue fix 1) | Rejected. It trusts directories owned by any unmapped user, which is the attack the check exists to stop. |
| Skip ownership checks for sandboxed launches (issue fix 2) | Rejected. The same hole, behind a launch flag. |
| Parent builds the generation and hands over a marker plus a bound directory (issue fix 3) | Not enough on its own: adoption still reads through `ancestors()`, and a writable bind lets the child write into trust it shares with the parent. Attestation solves the ownership question for both paths without that bind. |
| Compare `/proc/self/uid_map` alone | Not enough on its own: the map lists who is mapped, not who owns an unmapped inode. It is used only to detect the namespace. |
| Inode attestation from the parent (chosen) | Sound under the threat model above, local to the two files that own the rule, and reversible. |

## Open product choice (for Q, not decided here)

For an unattested namespace, the design refuses with a clear next step. The alternative is to start the engine without the imported OS roots, using Bun's bundled roots plus the user's own `NODE_EXTRA_CA_CERTS`. That would make hand-made sandboxes work, but corporate roots would silently disappear inside them. The recommendation is to refuse now and decide degradation separately.

## Tests

- RED, on Linux CI only, where unprivileged user namespaces work: run `prepareTrustDirectory` under real `bwrap` with the sandbox's arguments. Today it rejects with `unsafe trust ancestor`. After the fix, with the attestation, it returns a `/tmp/omo-engine-trust-*` directory.
- Unit, with injected stat and `/proc` readers: an overflow uid that is attested is accepted. Refused cases: not attested (another user), attested but group-writable, attested but a symlink, overflow uid while not in a namespace, unreadable `/proc`, and an overflow uid that does not match the kernel value.
- The producer emits only root-owned, safe ancestors, and emits nothing when it is not in the initial namespace.
- The sandbox transform sets `TMPDIR=/tmp` and the attestation variable on Linux, and leaves macOS unchanged.
- A read-only trust directory falls back to the temp directory with `trust-dir-readonly`.
