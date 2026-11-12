# Live QA pool: macOS

The per-PR live macOS tier cannot run on GitHub-hosted runners: the hosted-runner probe
(`crates/omo-computer-backend-macos/probes/hosted-macos-live.tsv`) measured that a pid-routed click does
not reach the target on macOS 15 or 26, so `HOSTED_MACOS_LIVE=no`. The tier runs instead on owned macOS
guests: one clone per macOS major per run, on a Mac compute host the lead places. Nothing is rented.

## What a run does

1. `bun script/qa/computer/pool/macos-vm.ts --up <15|26> --run-id <id>` clones the recorded base image
   of that major into a guest named `omo-cu-macos<major>-<id>` and starts it headless. The guest registers
   itself as an ephemeral runner with the labels `computer-live-macos` and `macos-<major>`. `--up` waits up
   to 120 s for the hypervisor to list the guest as running; a guest that never runs is deleted and `--up`
   exits 1.
2. The job on that runner builds the engine and its helper bundle with a run-local ad-hoc identity, grants
   it inside the guest, starts the fixture apps and runs the live scenario set. Each scenario prints one
   line (`script/qa/computer/pool/live-set.ts`):

   ```text
   SCENARIO <name> route=<synthetic-user|virtual-hid|none> PASS oracle=<independent oracle> refusal=<refusal leg>
   SCENARIO <name> route=<...> FAIL <what the oracle saw>
   SCENARIO <name> route=<...> BLOCKED reason=<why it cannot run here>
   ```

   then one summary line, `SET macos pass=<n> fail=<n> blocked=<n>[ reason=<reasons>]`. A set with a
   failure, or with no scenario at all, exits 1; a set where nothing passed (every scenario blocked) exits
   3, so a job never shows green while nothing ran. Before the macOS backend exists every scenario reads
   `BLOCKED reason=backend_not_built`, which is the honest starting state.
3. `bun script/qa/computer/pool/macos-vm.ts --down <15|26> --run-id <id>` always runs after the job and
   deletes the guest.

The physical stop-chord legs use the hypervisor's virtual keyboard (`route=virtual-hid`): the probe showed
the hosted runner's second-process keystroke is untagged, but that route is never the physical chord.

## Teardown receipts

`--down` prints two measured lines, in this order:

```text
procs <n>
guest DELETED omo-cu-macos<major>-<id>
```

`procs` counts the hypervisor's `run` processes still serving that guest; a count that cannot be read
prints `procs UNREAD`. Any count other than 0, `procs UNREAD`, or `guest NOT DELETED <name> (<reason>)`
makes the teardown exit 1. A failed guest list during the delete still prints the `NOT DELETED` line with
the list error as its reason.

`--sweep` deletes stopped guests this pool minted (names matching `omo-cu-<...>`) and keeps running ones,
printing `guest KEPT <name>` for each, because a running guest may belong to a live run. It never touches a
guest whose name it did not mint, including the base images.

## Pool host

| variable | meaning |
| --- | --- |
| `POOL_HYPERVISOR` | the hypervisor command: `clone <base> <name>`, `run --no-graphics <name>`, `list --format json`, `stop <name>`, `delete <name>` |
| `POOL_BASE_IMAGE_15`, `POOL_BASE_IMAGE_26` | the recorded base image of each major |

`macos-vm.ts` refuses, with the reason and exit 2, on a host that is not Apple-silicon macOS, has no
hypervisor command, has no base image for the major, or where anyone is signed in at the console: guests run only on a host
nobody is using. Teardown is never refused for that reason.

The first setup of a base image is a hands-on step, done once per major by a person at that Mac: sign in,
then allow Accessibility and Screen Recording for the QA identity. Every later guest is a headless clone.

## Status

Part 1 of this row: the pool tooling, its receipts and its tests. Every job that targets the
`computer-live-macos` label is a recorded drop for now: the hosted-runner probe measured that a
pid-routed click does not reach its target on hosted macOS 15 or 26 (`HOSTED_MACOS_LIVE=no`), and no
owned Mac or macOS guest exists to run the tier on. Those jobs, and the live scenario set they run, land in
part 2 once a machine exists and the cu-v3 driver rows land. The row stays open until every acceptance
line passes.
