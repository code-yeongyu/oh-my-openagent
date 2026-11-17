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
- **The stale-item report.** A later report on #13757, already public as a PR comment, adds a second state. The desktop app's own `omo-cli` item remains after the app is signed out. The CLI's `remove` is refused with `-25244` (`errSecInvalidOwnerEdit`). The app offers no sign-out in that state, so the user has no supported way to clear the item.

## Threat model scope

This note covers which code identity the item's access control trusts: path, DR, cdhash and partition matching, and the lifecycle of the item. Isolation from other code running as the same user is outside the scope of this note and is tracked separately.

One lifecycle requirement follows from the stale-item report and applies to every option below:

- the identity that wrote the item removes it when that identity signs out;
- an item that is provably stale (its writer is signed out, or no longer installed) has a defined removal path that doesn't depend on that writer being able to sign out.

## 2. What Apple documents

- A file-based keychain item has an access control list. A trusted-application entry records the application and its code requirement. For properly signed code, the entry is matched by the designated requirement, not by the path, so a moved or updated copy that satisfies the DR keeps access. Ad-hoc and unsigned code falls back to identity by path and hash, and gets prompts. Sources: TN3137 "On Mac keychain APIs and implementations", and Apple DTS in <https://developer.apple.com/forums/thread/764428>.
- Access has a **second gate**: the partition list. Since macOS 10.12, an item records the partitions allowed to use it without a prompt, typically `teamid:<team>` for code signed by an Apple-issued Developer ID, and an Apple or `cdhash:` style entry for other code. A caller has to pass both the trusted-application entry and the partition list. The author reads both refusals as reaching the helper as the same `errSecAuthFailed`, and so as the same `not-owned` reply. No Apple source states this; only the measurement (section 5) confirms it. A refusal could also come back with another status. `-25308` (`errSecInteractionNotAllowed`) is one candidate, and the helper reports it as `locked` even on an unlocked keychain (`NKH/src/verbs.c:28`). Partition entries can be read without a prompt and can be rewritten with the keychain password (`security set-generic-password-partition-list`).
- The data protection keychain uses keychain access groups instead of ACLs. The `keychain-access-groups` entitlement must be authorised by a provisioning profile, and a bare Mach-O command-line tool has nowhere to carry one; such a tool has to live in an app-like bundle (TN3137).
- If the documented behaviour holds for the Developer ID helper, the per-process path doesn't matter. #13757 would then have a different cause (possibly the partition list, possibly another identity rewriting the item), and moving the helper would fix nothing. **The first step is therefore a measurement (section 5), not a code change.**

## 3. Options

### A. A stable, user-writable helper path

One verified copy per helper content hash, under a per-user 0700 directory, written by atomic rename, mode 0500, and re-verified before each spawn.

- If the ACL matches by DR, a stable path is unnecessary.
- If the ACL matches by path, the stable path becomes the trust anchor, and a file that replaces it between verification and exec (TOCTOU), or between runs, may inherit the item's trust. Whether a path entry trusts different code at that path, or only code that also meets a recorded requirement, is unmeasured; step 9 of section 5 tests it.
- Today's per-process `mkdtemp` copy has the same shape. Its 0700 directory only keeps other users out. After the creator exits, its directory is deleted (`:49`), and the path recorded in the ACL can be recreated; that path is readable from the item without a prompt (`NKH/src/partition.c:58`). Under path matching, A would turn a short-lived path into a permanent one.
- **Rejected.** It's either useless or it weakens custody.

### B. An explicit trusted-application entry for a location same-user code can't replace

Build the trusted entry from the signed original instead of from the temporary copy, so the recorded path hint is stable and doesn't dangle. This only helps if the anchoring file can't be replaced by the user's own processes. A code-signature seal detects a modified file; it doesn't stop the file being swapped.

- **Desktop runtime.** B is limited to a helper inside an app bundle that the user's processes can't write: an app installed in `/Applications` by an administrator, owned by root, protected by macOS app management. There, nothing new becomes writable.
- **npm payload.** The npm install lives in user-writable package and cache directories. An entry anchored there is the same kind of same-user-writable anchor that A creates, so B can't be made safe for the npm install. Consequence: npm-installed omo keeps today's per-process custody until C ships. It gets no B entry.
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
- If the path decides the match, implement **B** for the root-owned desktop bundle only, and treat **C** as required, not long-term, because it's the only fix for the npm install.
- If the cdhash decides the match, plan **C**.
- Whatever the outcome, meet the lifecycle requirement from the threat model scope: the writer removes its item on sign-out, and a provably stale item has a defined removal path. The step 11 result decides whether that path can run from the CLI or must run from the app.

**A** stays rejected.

## 4. Existing items and rollout

- Items created by earlier helper copies keep their ACL and partition list. A refused read keeps going through today's paths: `approve`, and on a fresh sign-in the old item is renamed into an old slot (retired) so the new sign-in gets an item this helper owns. Sign-out reports the refusal by name.
- B ships behind the existing signature verification, only for the root-owned desktop bundle, and adds no writable anchor there. Rollout: an omo release, then the desktop pin, then one real-keychain check on a dedicated QA account. The check signs in, quits, signs out from a new process, and signs in again.
- C needs its own addendum to this document: profile provisioning, the bundle layout, hardened runtime and notarization, and the migration with its rollback for older pins.

## 5. Measurement plan (before any custody change)

This runs on a Mac, in a dedicated QA session, against a throwaway keychain. Release helpers refuse every argument (section 1), so it uses the **test** flavour, signed so its DR has the exact release form of `KH/signature.ts:6-8`.

**Signing is an owner action, and the route is (a).** The release/signing owner signs the test-flavour helper with the release Developer ID identity, on a machine that already holds it. No contributor uses or handles the release credential. This is the only route that gives both the release DR and a `teamid:523JNR86LZ` partition.

A test identity that Apple didn't issue isn't acceptable: its DR has a different form and no team, so its items get a non-`teamid:` partition, and a refusal would point at a cause that release builds don't have. If the owner can't sign under (a), the only fallback is a Developer ID identity issued by Apple to another team. That tests path versus DR versus cdhash matching and the partition behaviour of a `teamid:` partition. It doesn't test the release team's anchor or OU, and its results transfer to release builds only for the matching mechanism, not for the release identity itself.

Steps:

The order matters. `remove` deletes an owned item (`NKH/src/verbs.c:249-251`), and a later `read` that finds no item falls through to the staging lookup and replies `{"missing":true}` (`NKH/src/verbs.c:105-107`, `:132`). Every `remove` therefore runs last, and A re-creates the item before each reader, so every reader sees an item and every row below can be observed.

1. Build the test-flavour helper once and have the owner sign it. Check with `codesign -d -r-` that the DR equals `KH/signature.ts:6-8`, and record the team ID and cdhash with `codesign -dvvv`.
2. Copy the same signed binary to two directories, A and B. The copies are byte-identical, so the cdhash is equal.
3. Create and unlock a throwaway keychain with a known password. A: `write` with `--keychain <tmp> --no-ui`.
4. Record the item's ACL entries with `security dump-keychain -a <tmp>`: the trusted application's path and requirement, and the `ACLAuthorizationPartitionID` entry with its partition list (for example `teamid:523JNR86LZ`). This prints no secret.
5. Delete directory A, as the creator's exit does in production (`KH/pin.ts:49`). The ACL now holds a dangling path hint.
6. B: `read` only, with the same flags. Record each reply line (`owned`, `partition`, `error`, `status`), then repeat step 4.
7. Recreate directory A, copy the same binary back to A's original path, and have it `read`. This is the "same path" control: it separates "different path" from "dangling hint".
8. The owner re-signs a copy C with the same identity, so the cdhash differs and the DR is the same. C: `read`, then record as in step 4. This stands in for a new release build of the helper.
9. Different code at the recorded path. Replace the binary at A's original path with a copy that is ad-hoc signed (`codesign -s - -f`) and, as a second case, with one signed by a different identity. Each one: `read`, then record as in step 4. This tests whether a path entry trusts any code at that path or only code that also meets the recorded requirement. Put the signed binary back at A's path afterwards.
10. For every refusal in steps 6-9, attribute it: compare the reader's team and cdhash from step 1 with the partition list from step 4. Then add the reader's partition with `security set-generic-password-partition-list -S <partitions> -k <password> <tmp>`, record the list again, and repeat the refused call. A refusal that clears after this was the partition gate; one that persists was the trusted-application entry. Record the exact status of every refusal, not just the reply class.
11. Stale item written by the app. This step doesn't use `<tmp>`. The app writes through its bundled release helper, which refuses `--keychain` and only reaches the login keychain (section 1), so the item lives in the **login keychain of the dedicated QA macOS account**, under service `omo-cli`. Give it an account value that no earlier step uses, for example the hash of a dedicated test origin that exists only for this step, and record that value. A shared account would collide with step 3's item: the add would become an update of an item the app doesn't own and come back `not-owned` (`NKH/src/verbs.c:197-200`, `:188-189`), so no app-owned item would exist. Then:
    - have the desktop app sign in against the test origin, so its helper writes the item;
    - record the item's ACL and partition list as in step 4, using the login keychain path;
    - sign the app out, and record whether the item is still there and its partition list;
    - run the CLI helper's `read`, then its `remove`, on that service and account. Record each reply line and exact status (for example `-25244`, `errSecInvalidOwnerEdit`), and the partition entries after each call.
12. Removal last. B: `remove`, and record the reply and status. If an earlier step left no item, A writes it first.
13. Delete the throwaway keychain and the directories. Then remove step 11's item from the QA account's login keychain with `security delete-generic-password -s omo-cli -a <step-11 account>`, and confirm it's gone: `security find-generic-password -s omo-cli -a <step-11 account>` must report that the item couldn't be found.

Interpretation (the author expects a refusal to be `-25293`, `errSecAuthFailed`, reported as `not-owned` or `"owned":false`; the measurement confirms or refutes this):

| Result | Meaning | Next |
|---|---|---|
| B owned, C owned | The DR decides the match, even with a dangling path hint; path isn't the cause. | Look elsewhere, starting with which identity last rewrote the item's ACL or partition list during the desktop session. |
| B or C refused, cleared by step 10 | A partition mismatch, not a path or cdhash mismatch. The partition list doesn't contain the reader's partition. | Fix how the partition is set at creation in a separate design; custody location is not the cause. |
| B refused after step 10, A's recreated path (step 7) owned | The path is part of the match. | Implement B for the root-owned desktop bundle and schedule C for the npm install. |
| B and A's recreated path both refused after step 10 | The dangling hint itself breaks matching; even the creator's path fails once deleted. | Implement B for the desktop bundle and schedule C; record that path matching is by file identity, not name. |
| B owned, C refused after step 10 | The match is by cdhash; every helper update orphans items. | Plan C. |
| Different code at A's path (step 9) owned | A path entry trusts whatever code sits at the path. | Treat any path-anchored entry as unsafe unless the path is root-owned; B only for the root-owned bundle, C for everything else. |
| Different code at A's path (step 9) refused after step 10, signed copy owned | The path entry also checks a code requirement. A refusal at step 9 alone doesn't show this: the foreign binary's `cdhash:` or other-team partition isn't on the item's list (section 2), so the partition gate may be the only cause. | Record which requirement; section 3A's TOCTOU concern then applies only to code meeting it. |
| A refusal with any status other than `-25293`, including `-25308` reported as `locked` on the unlocked keychain | The reply class doesn't match the cause; `-25308` is mapped to `locked` (`NKH/src/verbs.c:28`). | Record the status per gate, and correct the helper's classification in a separate change before relying on it. |
| CLI `remove` of the app's item (step 11) refused, for example `-25244` | Only the writer can remove the item; a signed-out app leaves it stranded. | Require removal on the app's sign-out, and define a stale-item removal path that runs from the app identity. |
| CLI `remove` of the app's item (step 11) succeeds | The CLI can clear a stale app item. | Use it as the defined stale-item path, still with removal on the app's sign-out. |
