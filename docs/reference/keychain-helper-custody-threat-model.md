# macOS keychain helper custody threat model (#13757)

This is the security design that has to pass review before any change to where omo's macOS keychain helper runs from, or to what the `omo-cli` item's access control trusts. It changes no code. It records what today's code does, cited as `path:line` at `origin/dev` 587f207165, what Apple documents, the options, and the measurement that decides between them.

The trigger is #13757. In a GUI session, `omo logout` failed with "Cannot access macOS Keychain. Unlock or enable the OS credential store" after a successful `omo login`, and the keychain was unlocked. A separate change names that refusal correctly; it does not change custody and is out of scope here.

Paths are relative to the repository root. `KH` stands for `packages/omo-opencode/src/cli/service-auth/keychain-helper` and `NKH` for `packages/omo-native/keychain-helper`.

## 1. Current custody

- **Launch.** `KH/pin.ts:45-50` creates one private directory per process: `mkdtemp` under `$TMPDIR`, mode 0700, named `omo-keychain-<pid>-*`. `KH/pin.ts:66-90` copies the located helper into it, sets the copy to `0500` (`:74`), and verifies the signature of the copy, not of the original. Only that copy is spawned, so a file written to the original path later (a dev build, a broken install) is never executed. The directory is removed when the process exits.
- **Item creation.** `NKH/src/store.c:169-179` (`add_owned`) passes an explicit `kSecAttrAccess`. `NKH/src/store.c:151-158` (`owner_access`) builds it with `SecAccessCreate`. The trusted list has exactly one entry, `SecTrustedApplicationCreateFromPath(NULL)`, which is the running copy.
- **The assumption.** `KH/pin.ts:95` states that a copy has the same designated requirement (DR) as the original, so every copy at any path matches the one ACL entry (#11262 design 1). The release DR is `KH/signature.ts:7` (identifier `com.mengmota.omo-keychain-helper`, Apple-anchored Developer ID leaf). `NKH/gui-session-runner.ts:1` labels its claims `[unverified]`. None of its steps reads or removes an item with a second copy at another path; `own-identity-with-partition` at `:86` is the creator acting on its own item. The assumption has never been measured.
- **Release helpers take no arguments.** `NKH/src/main.c:37-54` refuses any argv in a release build: no `--keychain`, no `--no-ui`. A release helper can therefore only be exercised against the login keychain. A throwaway-keychain measurement needs the test flavour.
- **The field report.** In #13757 the second process (`omo logout`) did not own the item. `KH/darwin-store.ts:107-109` sends `remove`. The helper answers `not-owned` from `NKH/src/verbs.c:242`. The fallback delete by the omo binary itself is refused as well. Earlier in the same session, a `"<uuid>-omo-keychain" wants to access key "omo-cli"` dialog appeared; that is the `approve` path (`NKH/src/verbs.c:154`), which runs only when the running copy is not the owner. Both observations fit a match that depends on more than the DR.

## 2. What Apple documents

- A file-based keychain item has an access control list. A trusted-application entry records the application and its code requirement. For properly signed code, the entry is matched by the designated requirement, not by the path, so a moved or updated copy that satisfies the DR keeps access. Ad-hoc and unsigned code falls back to identity by path and hash, and gets prompts. Sources: TN3137 "On Mac keychain APIs and implementations", and Apple DTS in <https://developer.apple.com/forums/thread/764428>.
- The data protection keychain uses keychain access groups instead of ACLs. The `keychain-access-groups` entitlement must be authorised by a provisioning profile, and a bare Mach-O command-line tool has nowhere to carry one; such a tool has to live in an app-like bundle (TN3137).
- If the documented behaviour holds for the Developer ID helper, the per-process path does not matter. #13757 would then have a different cause, and moving the helper would fix nothing. **The first step is therefore a measurement (section 5), not a code change.**

## 3. Options

### A. A stable, user-writable helper path

One verified copy per helper content hash, under a per-user 0700 directory, written by atomic rename, mode 0500, and re-verified before each spawn.

- If the ACL matches by DR, a stable path is unnecessary.
- If the ACL matches by path, the stable path becomes the trust anchor. Any process of the same user can replace the file between verification and exec (TOCTOU), or between runs, and the replacement inherits the item's trust. The per-process `mkdtemp` copy exists to avoid exactly this.
- **Rejected.** It is either useless or it weakens custody.

### B. An explicit DR-based trusted-application entry

Build the trusted entry from the signed original inside the sealed app bundle (or the npm payload) instead of from the temporary copy. The recorded path hint is then stable, and matching rests on the DR. Nothing new becomes writable. This option only matters if the measurement shows that the entry's path hint, and not the DR, decides the match today. Items created earlier keep their ACL (section 4).

### C. The data protection keychain with an access group

Ship the helper as an app-like bundle (`Contents/MacOS/omo-keychain` and `Contents/embedded.provisionprofile`) with a team-prefixed `keychain-access-groups` entitlement, and store the item with `kSecUseDataProtectionKeychain`. Access is bound to the signing team and the group, never to a path. This is the cleanest custody.

Costs:
- a Developer ID provisioning profile in the release pipeline;
- a bundle layout for both the desktop runtime and the npm payload;
- a one-time migration of the item from the file-based keychain: read it with today's helper, write it to the data protection keychain, retire the old item.

### D. No custody change

Keep today's model and route sign-out of a non-owned item through `approve` instead of failing. This is a user-experience fallback only and does not remove the prompt.

### Recommendation

Measure first. If the DR does not decide the match, implement **B** now and plan **C** as the long-term custody. **A** stays rejected.

## 4. Existing items and rollout

- Items created by earlier helper copies keep their ACL. A refused read keeps going through today's paths: `approve`, and on a fresh sign-in the old item is moved aside (retired) so the new sign-in gets an item this helper owns. Sign-out reports the refusal by name.
- B ships behind the existing signature verification and adds no writable path. Rollout: an omo release, then the desktop pin, then one real-keychain check on a dedicated QA account. The check signs in, waits, signs out from a new process, and signs in again.
- C needs its own addendum to this document: profile provisioning, the bundle layout, and the migration with a rollback.

## 5. Measurement plan (before any custody change)

This runs on a Mac, in a dedicated QA session, against a throwaway keychain. Release helpers refuse every argument (section 1), so it uses the **test** flavour, with a DR in the release form: identifier plus certificate anchor, not a cdhash.

**Signing is an owner action.** No contributor uses the Developer ID signing credential on their own. The reviewers of this design and the release owner pick one of these:

- **(a)** The release/signing owner signs the test-flavour helper with the release identity, on a machine that already holds it. This gives the exact release DR.
- **(b)** The measurement uses a separate test identity whose DR has the same shape (identifier plus leaf certificate anchor). This tests path versus DR matching, but not the release team's anchor itself.

Steps:

1. Build the test-flavour helper once and have it signed by option (a) or (b). Check with `codesign -d -r-` that the DR has the expected form; with option (a) it equals `KH/signature.ts:7`.
2. Copy the same signed binary to two directories, A and B. The copies are byte-identical, so the cdhash is equal.
3. Create and unlock a throwaway keychain. A: `write` with `--keychain <tmp> --no-ui`.
4. Record the item's ACL entries (application path and requirement) with `security dump-keychain -a <tmp>`. This prints no secret.
5. B: `read`, then `remove`, with the same flags. Record each reply line (`owned`, `error`, `status`).
6. The same owner re-signs a copy C with the same identity, so the cdhash differs and the DR is the same. C: `read`. This stands in for a new release build of the helper.
7. Delete the keychain and the directories.

Interpretation:

| Result | Meaning | Next |
|---|---|---|
| B owned, C owned | The DR decides the match; path is not the cause. | Look elsewhere, starting with which identity last rewrote the item during the desktop session. |
| B refused (`-25293`) | The path is part of the match. | Implement B. |
| B owned, C refused | The match is by cdhash; every helper update orphans items. | Plan C. |
