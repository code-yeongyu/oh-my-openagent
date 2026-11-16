# macOS keychain helper custody threat model (#13757)

This is the security design that has to pass review before any change to where omo's macOS keychain helper runs from, or to what the `omo-cli` item's access control trusts. It changes no code. It records what today's code does, cited as `path:line` at `origin/dev` 587f207165, what Apple documents, the options, and the measurement that decides between them.

The trigger is #13757. In a GUI session, `omo logout` failed with "Cannot access macOS Keychain. Unlock or enable the OS credential store" after a successful `omo login`, and the keychain was unlocked. A separate change names that refusal correctly; it doesn't change custody and is out of scope here.

Paths are relative to the repository root. `KH` stands for `packages/omo-opencode/src/cli/service-auth/keychain-helper` and `NKH` for `packages/omo-native/keychain-helper`.

## 1. Current custody

- **Launch.** `KH/pin.ts:45-52` creates one private directory per process: `mkdtemp` under `$TMPDIR`, mode 0700, named `omo-keychain-<pid>-*` (`:48`). `KH/pin.ts:66-89` copies the located helper into it, sets the copy to `0500` (`:74`), and verifies the signature of the copy, not of the original (`:81`). Only that copy is spawned, so a file written to the original path later (a dev build, a broken install) is never executed. The directory is removed when the process exits (`:49`), so the path the item's ACL recorded no longer exists once its creator is gone.
- **Item creation.** `NKH/src/store.c:169-181` (`add_owned`) passes an explicit `kSecAttrAccess`. `NKH/src/store.c:151-163` (`owner_access`) builds it with `SecAccessCreate`. The trusted list has exactly one entry, `SecTrustedApplicationCreateFromPath(NULL)` (`:153`), which is the running copy.
- **Partition list.** Besides the trusted-application list, a file-based item carries an `ACLAuthorizationPartitionID` entry whose description lists partitions such as `teamid:<team>`. The helper already reads it: `NKH/src/partition.c:56-76` (`partition_kind`) fetches the item's access without a prompt (`:58`), selects the partition entries (`:59`), and classifies them as `ours`, `other`, `none` or `unknown` against `teamid:` plus the release team (`:32-54`, `:45`). A `read` of an item the helper doesn't own reports that class in its reply (`NKH/src/verbs.c:86-92`). `NKH/gui-session-runner.ts:80-83` stops unless the item got a partition naming a team.
- **The assumption.** `KH/pin.ts:94-95` states that a copy has the same designated requirement (DR) as the original, so every copy at any path matches the one ACL entry (#11262 design 1). The release DR is `KH/signature.ts:6-8`: identifier `com.mengmota.omo-keychain-helper`, `anchor apple generic`, the Developer ID intermediate and leaf certificate fields, and team OU `523JNR86LZ` (`:8`). `NKH/gui-session-runner.ts:1` labels its claims `[unverified]`. None of its steps reads or removes an item with a second copy at another path; `own-identity-with-partition` at `:86` is the creator acting on its own item. The assumption has never been measured.
- **Release helpers take no arguments.** `NKH/src/main.c:37-56` refuses any argv in a release build (`:54`): no `--keychain`, no `--no-ui`. A release helper can therefore only be exercised against the login keychain. A throwaway-keychain measurement needs the test flavour.
- **The field report.** In #13757 the second process (`omo logout`) didn't own the item. `KH/darwin-store.ts:107-109` sends `remove`. `verb_remove` (`NKH/src/verbs.c:242`) answers `not-owned` at `:248`. The fallback delete by the omo binary itself (`KH/darwin-store.ts:109`) is refused as well. Earlier in the same session, a `"<uuid>-omo-keychain" wants to access key "omo-cli"` dialog appeared; that's the `approve` path (`NKH/src/verbs.c:154`), which runs only when the running copy isn't the owner. Both observations fit a match that depends on more than the DR, but `not-owned` is any `errSecAuthFailed` on an unlocked keychain (`NKH/src/verbs.c:247-248`). It doesn't say which gate refused.

## 2. What Apple documents

- A file-based keychain item has an access control list. A trusted-application entry records the application and its code requirement. For properly signed code, the entry is matched by the designated requirement, not by the path, so a moved or updated copy that satisfies the DR keeps access. Ad-hoc and unsigned code falls back to identity by path and hash, and gets prompts. Sources: TN3137 "On Mac keychain APIs and implementations", and Apple DTS in <https://developer.apple.com/forums/thread/764428>.
- Access has a **second gate**: the partition list. Since macOS 10.12, an item records the partitions allowed to use it without a prompt, typically `teamid:<team>` for code signed by an Apple-issued Developer ID, and an Apple or `cdhash:` style entry for other code. A caller has to pass both the trusted-application entry and the partition list. Either refusal reaches the helper as the same `errSecAuthFailed`, and so as the same `not-owned` reply. Partition entries can be read without a prompt and can be rewritten with the keychain password (`security set-generic-password-partition-list`).
- The data protection keychain uses keychain access groups instead of ACLs. The `keychain-access-groups` entitlement must be authorised by a provisioning profile, and a bare Mach-O command-line tool has nowhere to carry one; such a tool has to live in an app-like bundle (TN3137).
- If the documented behaviour holds for the Developer ID helper, the per-process path doesn't matter. #13757 would then have a different cause (possibly the partition list, possibly another identity rewriting the item), and moving the helper would fix nothing. **The first step is therefore a measurement (section 5), not a code change.**

## 3. Options

### A. A stable, user-writable helper path

One verified copy per helper content hash, under a per-user 0700 directory, written by atomic rename, mode 0500, and re-verified before each spawn.

- If the ACL matches by DR, a stable path is unnecessary.
- If the ACL matches by path, the stable path becomes the trust anchor. Any process of the same user can replace the file between verification and exec (TOCTOU), or between runs, and the replacement inherits the item's trust.
- Today's per-process `mkdtemp` copy doesn't fully avoid this either. Its 0700 directory belongs to the same user, so it only keeps other users out. Same-user code can swap the verified copy between verification (`KH/pin.ts:81`) and spawn. After the creator exits, its directory is deleted (`:49`), and any process of the same user can recreate the exact path recorded in the ACL; that path is readable from the item without a prompt (`NKH/src/partition.c:58`). The per-process copy is harder to target because its path is unknown until it's created, not because it's out of reach. **If the measurement shows path matching, today's design is already exploitable by same-user code**, and A would make that permanent.
- **Rejected.** It's either useless or it weakens custody.

### B. An explicit trusted-application entry for a location same-user code can't replace

Build the trusted entry from the signed original instead of from the temporary copy, so the recorded path hint is stable and doesn't dangle. This only helps if the anchoring file can't be replaced by the user's own processes. A code-signature seal detects a modified file; it doesn't stop the file being swapped.

- **Desktop runtime.** B is limited to a helper inside an app bundle that the user's processes can't write: an app installed in `/Applications` by an administrator, owned by root, protected by macOS app management. There, nothing new becomes writable.
- **npm payload.** The npm install lives in user-writable package and cache directories. An entry anchored there is the same kind of same-user-writable anchor that A creates, so B can't be made safe for the npm install. Consequence: if the measurement shows path matching, npm-installed omo keeps today's per-process custody, with the exposure described under A, until C ships. It gets no B entry.
- B only matters if the measurement shows that the entry's path, and not the DR, decides the match. Items created earlier keep their ACL (section 4).

### C. The data protection keychain with an access group

Ship the helper as an app-like bundle (`Contents/MacOS/omo-keychain` and `Contents/embedded.provisionprofile`) with a team-prefixed `keychain-access-groups` entitlement, and store the item with `kSecUseDataProtectionKeychain`. Access is bound to the signing team and the group, never to a path. This is the cleanest custody, and the only option that covers the npm install as well.

Costs:
- a Developer ID provisioning profile in the release pipeline;
- a bundle layout for both the desktop runtime and the npm payload;
- the helper must run in place: the entitlement is only honoured with the bundle's embedded provisioning profile, so copying the executable to a temporary directory (`KH/pin.ts:66-89`) stops working and the per-process copy goes away; custody against swapping then rests on bundle signature checks at launch;
- hardened runtime and notarization for the entitled bundle, in every release flavour that ships it;
- a one-time migration of the item from the file-based keychain: read it with today's helper, write it to the data protection keychain, retire the old item;
- a rollback and downgrade path: older desktop pins and older omo releases read only the file-based item, so the migration must keep that item readable (or restorable) until no supported pin depends on it.

### D. No custody change

Keep today's model and route sign-out of a non-owned item through `approve` instead of failing. This is a user-experience fallback only and doesn't remove the prompt.

### Recommendation

Measure first, with the partition list recorded and the signing route fixed to (a). Then:

- If the DR decides both gates, custody isn't the cause of #13757; look elsewhere and change nothing here.
- If the partition list refuses, fix how the partition is set at creation (a separate design), not where the helper runs.
- If the path decides the match, today's design is exploitable by same-user code. Implement **B** for the root-owned desktop bundle only, and treat **C** as required, not long-term, because it's the only fix for the npm install.
- If the cdhash decides the match, plan **C**.

**A** stays rejected.

## 4. Existing items and rollout

- Items created by earlier helper copies keep their ACL and partition list. A refused read keeps going through today's paths: `approve`, and on a fresh sign-in the old item is moved aside (retired) so the new sign-in gets an item this helper owns. Sign-out reports the refusal by name.
- B ships behind the existing signature verification, only for the root-owned desktop bundle, and adds no writable anchor there. Rollout: an omo release, then the desktop pin, then one real-keychain check on a dedicated QA account. The check signs in, quits, signs out from a new process, and signs in again.
- C needs its own addendum to this document: profile provisioning, the bundle layout, hardened runtime and notarization, and the migration with its rollback for older pins.

## 5. Measurement plan (before any custody change)

This runs on a Mac, in a dedicated QA session, against a throwaway keychain. Release helpers refuse every argument (section 1), so it uses the **test** flavour, signed so its DR has the exact release form of `KH/signature.ts:6-8`.

**Signing is an owner action, and the route is (a).** The release/signing owner signs the test-flavour helper with the release Developer ID identity, on a machine that already holds it. No contributor uses or handles the release credential. This is the only route that gives both the release DR and a `teamid:523JNR86LZ` partition.

A test identity that Apple didn't issue isn't acceptable: its DR has a different form and no team, so its items get a non-`teamid:` partition, and a refusal would point at a cause that release builds don't have. If the owner can't sign under (a), the only fallback is a Developer ID identity issued by Apple to another team. That tests path versus DR versus cdhash matching and the partition behaviour of a `teamid:` partition. It doesn't test the release team's anchor or OU, and its results transfer to release builds only for the matching mechanism, not for the release identity itself.

Steps:

1. Build the test-flavour helper once and have the owner sign it. Check with `codesign -d -r-` that the DR equals `KH/signature.ts:6-8`, and record the team ID and cdhash with `codesign -dvvv`.
2. Copy the same signed binary to two directories, A and B. The copies are byte-identical, so the cdhash is equal.
3. Create and unlock a throwaway keychain with a known password. A: `write` with `--keychain <tmp> --no-ui`.
4. Record the item's ACL entries with `security dump-keychain -a <tmp>`: the trusted application's path and requirement, and the `ACLAuthorizationPartitionID` entry with its partition list (for example `teamid:523JNR86LZ`). This prints no secret.
5. Delete directory A, as the creator's exit does in production (`KH/pin.ts:49`). The ACL now holds a dangling path hint.
6. B: `read`, then `remove`, with the same flags. Record each reply line (`owned`, `partition`, `error`, `status`), then repeat step 4.
7. Recreate directory A, copy the same binary back to A's original path, and have it `read`. This is the "same path" control: it separates "different path" from "dangling hint".
8. The owner re-signs a copy C with the same identity, so the cdhash differs and the DR is the same. C: `read`, then record as in step 4. This stands in for a new release build of the helper.
9. For every refusal in steps 6-8, attribute it: compare the reader's team and cdhash from step 1 with the partition list from step 4. Then add the reader's partition with `security set-generic-password-partition-list -S <partitions> -k <password> <tmp>`, record the list again, and repeat the refused call. A refusal that clears after this was the partition gate; one that persists was the trusted-application entry.
10. Delete the keychain and the directories.

Interpretation (every refusal is `-25293`, `errSecAuthFailed`, reported as `not-owned` or `"owned":false`):

| Result | Meaning | Next |
|---|---|---|
| B owned, C owned | The DR decides the match, even with a dangling path hint; path isn't the cause. | Look elsewhere, starting with which identity last rewrote the item's ACL or partition list during the desktop session. |
| B or C refused, cleared by step 9 | A partition mismatch, not a path or cdhash mismatch. The partition list doesn't contain the reader's partition. | Fix how the partition is set at creation in a separate design; custody location is not the cause. |
| B refused after step 9, A's recreated path (step 7) owned | The path is part of the match. Today's per-process design is exploitable by same-user code that recreates an exited path (section 3A). | Implement B for the root-owned desktop bundle and schedule C for the npm install. |
| B and A's recreated path both refused after step 9 | The dangling hint itself breaks matching; even the creator's path fails once deleted. | Implement B for the desktop bundle and schedule C; record that path matching is by file identity, not name. |
| B owned, C refused after step 9 | The match is by cdhash; every helper update orphans items. | Plan C. |
