// Row 51 on headless sway, sending nothing: the engine's libei client connects on the
// LIBEI_SOCKET route, reads the keymap the EIS server fed (never a hand-rolled one), and after
// the server drops it once, reconnects within the bounded backoff instead of giving up. The
// fake EIS's own log is the oracle for connections, drops, keymaps fed and frames; the keymap's
// group names are read from the compiled file; the output geometry comes from swaymsg.
import type { Checked, Context, Scenario } from "../lib/scenario.ts"
import { until } from "../lib/procs.ts"
import { compileKeymap, count, startFakeEis } from "./fake-eis.ts"

// crates/omo-computer-backend-wayland/src/input/link.rs RECONNECT_BACKOFF_MS (250 + 500 + 1000)
// plus one handshake's slack - the bound the crate's own reconnect test uses.
const RECONNECT_BOUND_MS = 2_750

interface Check {
  readonly name: string
  readonly state: string
  readonly reason?: string
}

function probe(diagnosis: { checks?: Check[] }, name: string): Check | undefined {
  return diagnosis.checks?.find((check) => check.name === name)
}

export const libeiConnectKeymapReconnect: Scenario = {
  name: "libei-connect-keymap-reconnect",
  admit: "none",
  sessions: ["sway"],
  requires: ["xkbcli", "swaymsg"],
  async run(ctx: Context): Promise<Checked> {
    const { engine, procs, stage } = ctx
    const outputs = JSON.parse(await procs.stdout(["swaymsg", "-t", "get_outputs", "-r"], stage.env)) as {
      name: string
      rect: { x: number; y: number; width: number; height: number }
    }[]
    const regions = outputs.map(({ rect }) => `${rect.x},${rect.y},${rect.width},${rect.height}`)
    const keymap = await compileKeymap(ctx, "us,fr")
    const eis = await startFakeEis(ctx, keymap, "drop-once", regions)
    try {
      await engine.open("none")
      const capabilities = (await engine.call("capabilities")) as { compositor?: { name?: string } }
      const first = (await engine.call("diagnose")) as { checks?: Check[] }
      const connected = eis.read()
      await until(() => count(eis.read(), "dropped") === 1, "the fake EIS to drop the engine's client once")
      const started = performance.now()
      const second = (await engine.call("diagnose")) as { checks?: Check[] }
      const tookMs = Math.round(performance.now() - started)
      const after = eis.read()
      const expectedKeymap = keymap.groups.join(", ")
      return {
        checks: {
          compositor_reads_sway: capabilities.compositor?.name === "sway",
          libei_connects_on_the_socket_route:
            probe(first, "libei")?.state === "ok" && probe(first, "libei")?.reason === "libei_socket",
          fake_saw_one_connection_before_the_drop: count(connected, "connections") === 1,
          keymap_is_the_one_the_server_fed:
            keymap.groups.length === 2 && probe(first, "keymap")?.reason === expectedKeymap,
          no_reconnect_before_the_drop: probe(first, "libei_reconnects")?.reason === "0",
          reconnected_once_after_the_drop:
            probe(second, "libei")?.state === "ok" && probe(second, "libei_reconnects")?.reason === "1",
          fake_saw_exactly_one_reconnect: count(after, "connections") === 2 && count(after, "dropped") === 1,
          keymap_reread_on_the_new_connection:
            count(after, "keymapsFed") === 2 && probe(second, "keymap")?.reason === expectedKeymap,
          reconnect_within_the_bound: tookMs <= RECONNECT_BOUND_MS,
          nothing_was_sent: count(after, "frames") === 0 && count(after, "keys") === 0,
        },
        facts: {
          outputs: regions,
          keymap_groups: [...keymap.groups],
          engine_keymap: probe(second, "keymap")?.reason ?? null,
          reconnect_ms: tookMs,
          reconnect_bound_ms: RECONNECT_BOUND_MS,
          input_sent: 0,
        },
        observer: { before: connected, after },
      }
    } finally {
      await eis.stop()
    }
  },
}
