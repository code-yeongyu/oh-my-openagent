# @sisyphuslabs/bunshin-ts

Transport-agnostic bunshin requester client. `connect({ transport })` builds a `BunshinClient` over any
`MachineHubTransport`: list machines, run operations on one machine, and stream a fanout across many.

```ts
import { connect } from "@sisyphuslabs/bunshin-ts"

const client = await connect({ transport })
const machines = await client.listMachines()
```

The package ships compiled ESM with TypeScript declarations and runs on Node.js and Bun. It brings no transport of its
own; pass one that implements `MachineHubTransport`.

Proprietary software. See `LICENSE` for the terms; no open-source license is granted.
