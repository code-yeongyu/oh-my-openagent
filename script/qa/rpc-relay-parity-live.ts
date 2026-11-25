// The live relay parity sweep (#13478) on a real pair of signed-in devices. One entry for the three roles:
//   bun script/qa/rpc-relay-parity-live.ts --device <target device id> --local '<cmd>' --relay '<cmd>' --out <prefix>
//     the driver (rpc-relay-parity-drive.ts): `<cmd>` runs one leg on its device and speaks JSON lines on stdin/stdout;
//   bun script/qa/rpc-relay-parity-live.ts leg local    on the target device: its own engine socket (local-leg.ts);
//   bun script/qa/rpc-relay-parity-live.ts leg relay    on the second device: its device service and the relay.
import { argv } from "node:process"

const [mode, leg] = argv.slice(2)
if (mode === "leg" && leg === "local") await import("./rpc-relay-parity-local-leg")
else if (mode === "leg" && leg === "relay") await import("./rpc-relay-parity-relay-leg")
else if (mode === "leg") {
  console.error(`unknown leg ${String(leg)} (local or relay)`)
  process.exit(2)
} else await import("./rpc-relay-parity-drive")
