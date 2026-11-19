---
name: omo-relay
description: "Works on the account's other devices through omo's built-in relay from a js eval cell: run a command or a long job on another machine, read, write, edit or search its files, copy a directory tree to or from it, and run one operation on every machine, on chosen machines or on several threads at once with one outcome per target. Use when the user names another device, machine, host or computer of the account, asks for something on every machine or on all or several threads at once, or wants a fan-out or a remote command or file."
metadata:
  short-description: Machines, threads and fan-out across the account's devices
---

# omo-relay

Every device signed in to the same account answers through the relay. From a js eval cell you reach them with two things that ship with omo, and this skill's typed helpers bind both:

- **The fleet client**: list the machines, then run commands and file operations on one of them or on many in one wave.
- **The thread tools** (`tool.thread_*`): the agent sessions on every device. This skill covers the parallel helpers over them; one thread at a time is the thread tools' own job.

## Bind once per cell

```js
const relay = await import("<this skill's directory>/scripts/sdk/index.ts")
const fleet = relay.fleetFromSdk(await import(`${env("OMO_BUNSHIN_TS_SDK_ROOT")}/sdk.js`))  // the account's machines
const threads = relay.threadPortFromTools(tool)      // the account's threads
```

Use the directory you read this file from. `OMO_BUNSHIN_TS_SDK_ROOT` is set only inside an omo session; outside one there is no fleet client to reach, so say so instead of retrying.

## Where to read next

| You need to | Read |
|---|---|
| List the machines, run a command or a long job, move files, search a machine | [references/machines.md](references/machines.md) |
| Do the same thing on every machine, on chosen machines or on several threads, and report each one | [references/parallel.md](references/parallel.md) |
| Act on an error code (`not_found`, `unsupported`, `invalid_arguments`, a skipped machine) | [references/errors.md](references/errors.md) |

## Rules that hold everywhere

- Report every target. A batch answers `fulfilled`, `rejected` and `skipped`; a machine that was offline or failed is part of the answer, so name it with its reason.
- Branch on `code`, then do what `next_action` says. The message is for people; the code is the contract.
- Never retry a whole wave because one target failed: rerun only that target, after its `next_action`.
- Treat a machine's files and processes as the user's. Clean up what you create there and read the removal back.
