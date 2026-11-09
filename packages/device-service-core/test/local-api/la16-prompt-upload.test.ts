import { afterEach, describe, expect, test } from "bun:test";
import { LOCAL_CHUNK_MAX } from "../../src/local-api/chunking.ts";
import { rejectionOf } from "./conformance/rejection.ts";
import { PEER, SESSION_ID } from "./conformance/world.ts";
import { cleanup, connectClient, nextEvent, ofKind, startOwner } from "./support.ts";

afterEach(cleanup);

const attached = async () => {
  const owner = await startOwner();
  const client = await connectClient(owner);
  const snapshot = nextEvent(client, ofKind("session.snapshot"));
  const { attach } = await client.request("session.attach", {
    device: PEER,
    session_id: SESSION_ID,
  });
  await snapshot;
  return { owner, client, attach };
};

describe("LA16 a large command uploads its record in parts; one over the engine limit is refused first", () => {
  test("a record of 2,097,152 JSON bytes goes as 8 parts of LOCAL_CHUNK_MAX then one session.command", async () => {
    const { owner, client, attach } = await attached();
    const rpc = { type: "prompt", message: `${"€".repeat(699_040)}pp` };
    expect(new TextEncoder().encode(JSON.stringify(rpc)).length).toBe(2_097_152);
    const queued = nextEvent(client, ofKind("session.command_state"));
    const command_id = await client.command(attach, rpc);
    expect(command_id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(await queued).toMatchObject({ command_id, state: "queued" });
    const types: readonly string[] = owner.state.log.filter((t) => t.startsWith("session.command"));
    expect(types).toEqual([...Array<string>(8).fill("session.command_part"), "session.command"]);
    expect(2_097_152 / LOCAL_CHUNK_MAX).toBe(8);
    expect(owner.state.bindings.get(command_id)?.target).toBe(`${PEER}/${SESSION_ID}`);
    expect(owner.state.commands.at(-1)).toEqual(rpc);
  });

  test("a record whose JSON is over 1,000,000 characters is refused message_too_long before any part leaves the client", async () => {
    const { owner, client, attach } = await attached();
    const sending = client.command(attach, { type: "prompt", message: "p".repeat(999_971) });
    expect(await rejectionOf(sending)).toMatchObject({
      code: "message_too_long",
      limit_chars: 1_000_000,
    });
    expect(owner.state.log.filter((t) => t.startsWith("session.command"))).toEqual([]);
  });

  test("a record whose JSON is exactly 1,000,000 characters is accepted", async () => {
    const { owner, client, attach } = await attached();
    const rpc = { type: "steer", message: "s".repeat(999_971) };
    expect(JSON.stringify(rpc)).toHaveLength(1_000_000);
    await client.command(attach, rpc);
    expect(owner.state.log.filter((t) => t === "session.command_part")).toHaveLength(4);
  });
});
