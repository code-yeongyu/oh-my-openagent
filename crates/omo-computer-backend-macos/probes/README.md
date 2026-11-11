# macOS spike probes

Spike instruments for the macOS backend. They ship no engine code: each spike is one Bun probe script, the shell
helpers it calls, and one ledger file that later constants cite as `cites <ledger file>:<row id>`.

## SP-T: TCC responsibility for the launcher (`probe-sp-t.ts`, ledger `macos-tcc.tsv`)

What it measures, one ledger row per question per condition:

| row id prefix | question |
|---|---|
| `charged.*` | which process `tccd` charges for the launcher: by-path `open` re-exec, `responsibility_spawnattrs_setdisclaim` spawn, a plain spawn (control); from a GUI-resident host and from an ssh child |
| `client-type.*` | which `client_type` `TCC.db` records for the grant (0 = bundle id, 1 = path), per launch path |
| `swap.*` | whether the grant survives a `generations/<cdhash>/` swap under `current`, per launch path |
| `identity-path.*` | the `identity.path` the launcher reports (`open_a` or `disclaim`) |
| `by-name-open-a.*` | with `current` and `previous` both registered, whether by-name `open -a` launches `current` |
| `rebuild.*` | whether a grant survives a rebuild signed with the same identity (same designated requirement, new cdhash) |
| `domain.*` | which launchd session the launcher lands in, from a GUI-resident host and from an ssh child |
| `prompt.*` | whether the TCC prompt appears at all for an ssh-spawned launcher (with a GUI positive control) |
| `bunshin-domain.*` | which launchd domain the bunshin agent runs in on a Mac |
| `untagged.*` | which key route a session tap sees as untagged hardware input (hypervisor keyboard in a VM, virtual HID device) |

Rows ending `.m26` run on the QA account's macOS 26 GUI session (host prerequisites H1/H3); rows ending `.m15` and
`untagged.hypervisor-vkbd` run inside a virtual machine (H2, `SPT_HOST_ROLE=h2`); `untagged.vhid` needs the virtual
HID keyboard (H4, `SPT_HW_ROUTE=vhid`). A row whose host or route does not exist yet reads `UNMEASURED` with the
reason in the `note` column; nothing is guessed.

Ledger columns: `id`, `question`, `condition`, `host`, `verdict`, `rerun`, `host_build`, `measured`, `evidence`,
`note`. The `evidence` column names the row's evidence file under the run's evidence root (`$EV`), which holds the
launcher's own report, the `tccd` log lines, and the `TCC.db` read-back.

### How the probe works

- The probe bundle is a minimal LSUIElement `omo-computer-helper.app` with the final bundle id
  `ai.sisyphuslabs.omo-computer-helper`, display name "OmO Computer Use" and `CFBundleExecutable`
  `omo-computer-engine`. It is signed with the run-local T3 identity (`sp-t-identity.sh create`: a self-signed
  code-signing certificate in a dedicated keychain file under `$CU_RUN/t3-signing/`; never the login keychain, no
  trust setting, no dialog).
- The executable reports its pid, parent, `proc_pidpath`, its responsible process
  (`responsibility_get_pid_responsible_for_pid`), `launchctl managername`, `SessionGetInfo`, and the three
  non-prompting preflights (`AXIsProcessTrusted`, `CGPreflightScreenCaptureAccess`,
  `CGPreflightListenEventAccess`). Only `--request-grant` and the `prompt.*` rows ask for a prompt; the prompt rows use
  a separate never-granted identifier (`...omo-computer-helper.sp-t-prompt`) and reset it with `tccutil` before and
  after.
- A GUI-resident host is a Bun process started by a one-shot LaunchAgent in `gui/<uid>` (`sp-t-gui-leg.sh`); an ssh
  child is the probe's own process context when the probe is started over ssh.
- `TCC.db` is read only (`sp-t-tccdb.sh`, `mode=ro`); reading it needs Full Disk Access for the reading process, and
  the system database also needs root. An unreadable database makes the `client-type.*` rows `UNMEASURED`.

### Host procedure

Run as an administrator account over ssh, with the QA account logged in to its GUI session, one run at a time.

```sh
export CU_RUN=<host-side run root, readable by the QA account>
export SPT_QA_USER=<QA account> SPT_COMMIT=<commit of this directory> SPT_BUN=<a bun the QA account can execute>
P=<this directory, staged under $CU_RUN>
bash $P/sp-t-identity.sh create                 # once per run; writes $CU_RUN/t3-signing/IDENTITY
bun $P/probe-sp-t.ts --setup                    # spawner, two generations (current, previous), the prompt probe
bun $P/probe-sp-t.ts --request-grant            # H3: the dialog for "OmO Computer Use"; grant it in System Settings
bun $P/probe-sp-t.ts --check-grant              # expects accessibility 1
bun $P/probe-sp-t.ts --measure --out $P/macos-tcc.tsv
bun $P/probe-sp-t.ts --verify $P/macos-tcc.tsv  # from a clean shell: every verdict identical, VERIFY_OK, exit 0
bun $P/probe-sp-t.ts --cleanup                  # receipts: procs 0, dir REMOVED; keeps the identity and the H3 grant
```

The `prompt.*` rows print an `OPERATOR:` line: a dialog naming "OmO Computer Use SP-T prompt probe" may appear in
the QA session and is answered Deny. The T3 identity and the H3 grant stay for the later macOS rows and are removed
at the final teardown (`sp-t-identity.sh delete`, and `tccutil reset` of the helper bundle id).

Any single row re-measures with the command in its `rerun` column. On a host without the preconditions (for example
a Linux compute host) every mode except `--print-skeleton` exits 2 with one line naming the first missing
precondition and writes no ledger row.
