import { afterEach, describe, expect, test } from "bun:test";
import { ROUND_DEVICE_STATES } from "../../src/local-api/protocol.ts";
import { validateEvent } from "../../src/local-api/validate.ts";
import { OFFLINE_PEER, PEER } from "./conformance/world.ts";
import { cleanup, connectClient, startOwner } from "./support.ts";

const echoed = (event: unknown): unknown => validateEvent(event);

afterEach(cleanup);

const round = (devices: unknown, state: unknown = "done") => ({
  type: "event",
  kind: "sessions.round",
  query_id: "q1",
  state,
  devices,
});

describe("LA14 sessions.round device states are exhaustive", () => {
  test("the device states are exactly the seven of the contract and each validates", () => {
    expect([...ROUND_DEVICE_STATES]).toEqual([
      "answered",
      "pending",
      "undelivered",
      "page_cap",
      "cursor_echo",
      "timed_out",
      "skipped",
    ]);
    const all = Object.fromEntries(ROUND_DEVICE_STATES.map((s, i) => [`dev-${i}`, s]));
    expect(echoed(round(all))).toEqual(round(all));
  });

  test("any other device or round state is refused", () => {
    for (const bad of ["unknown", "Answered", "expired", ""])
      expect(() => validateEvent(round({ [PEER]: bad })), bad).toThrow();
    expect(() => validateEvent(round({ [PEER]: "answered" }, "closed"))).toThrow();
    expect(() => validateEvent(round([]))).toThrow();
  });

  test("a list round ends done with every device's state, after its last listing_end", async () => {
    const owner = await startOwner();
    const client = await connectClient(owner);
    const order: string[] = [];
    client.onEvent((event) => {
      if (event.kind === "sessions.round" || event.kind === "sessions.listing_end")
        order.push(
          event.kind === "sessions.round" ? `round:${event.state}` : `end:${event.revision}`,
        );
    });
    const result = await client.list();
    expect(result.devices).toEqual({ [PEER]: "answered", [OFFLINE_PEER]: "undelivered" });
    expect(order).toEqual(["round:open", "end:1", "end:2", "round:done"]);
  });
});
