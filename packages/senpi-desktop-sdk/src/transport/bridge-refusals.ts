/**
 * Engine methods an attach client never sends: the daemon owns its session, grant and stop paths, as the
 * `--oneshot` / `--mcp` bridge does (`oneshot.rs`). Pinned against `engine.schema.json` by the attach test.
 */
export const BRIDGE_REFUSED_METHODS: Readonly<Record<string, "hostOnly" | "testOnly">> = {
  "session.open": "hostOnly",
  "session.close": "hostOnly",
  "session.viewerStatus": "hostOnly",
  "control.grant": "hostOnly",
  "control.revoke": "hostOnly",
  "stopPath.start": "hostOnly",
  "stopPath.heartbeat": "hostOnly",
  "stopPath.resume": "hostOnly",
  "$/test.advanceClock": "testOnly",
}
