# Errors

A failure carries `code`, `message` and `next_action`. In a batch it is the rejected outcome's `error`; from a direct machine call it is the thrown `BunshinSessionError`, with the same fields. Branch on `code` and follow `next_action`.

| Where | Code or reason | What it means | Do |
|---|---|---|---|
| a skipped machine | `machine_offline` | The device is not connected; nothing ran there. | Report it. Do not retry in a loop. |
| a skipped machine | `machine_unsupported` | The device's service cannot run machine operations. | Report it; omo on that device needs an update. |
| a machine call | `unsupported` | A direct call on a machine that cannot run it (seen on an offline device). | Read the row's `state` and `unsupported` first and pick another machine. |
| a machine call | `invalid_arguments` | The arguments do not match the operation (the message names the field). | Fix the arguments; resending the same call fails the same way. |
| a lookup | `not_found` | No machine has that id or alias. | Use an id or alias from `listMachines()`. |
| a lookup | `ambiguous` | Several machines share that alias. | Use the id. |
| a callback | `callback_failed` | Your callback threw something without a code. | Read the message; rerun for that target only. |
| any | `uncertain: true` | The operation may have run before the failure. | Check its effect on that machine before running it again. |

For a code not listed here, do what its `next_action` says.
