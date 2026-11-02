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

describe("LA16 a large prompt uploads in parts; one over the engine limit is refused first", () => {
  test("a 2,097,152-byte prompt goes as 8 parts of LOCAL_CHUNK_MAX then one session.command", async () => {
    const { owner, client, attach } = await attached();
    const text = `${"€".repeat(699_050)}pp`;
    expect(new TextEncoder().encode(text).length).toBe(2_097_152);
    const queued = nextEvent(client, ofKind("session.command_state"));
    const command_id = await client.command(attach, { op: "prompt", text });
    expect(command_id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(await queued).toMatchObject({ command_id, state: "queued" });
    const types: readonly string[] = owner.state.log.filter((t) => t.startsWith("session.command"));
    expect(types).toEqual([...Array<string>(8).fill("session.command_part"), "session.command"]);
    expect(2_097_152 / LOCAL_CHUNK_MAX).toBe(8);
    expect(owner.state.bindings.get(command_id)?.target).toBe(`${PEER}/${SESSION_ID}`);
    expect(owner.state.commands.at(-1)).toEqual({ op: "prompt", text });
  });

  test("a prompt of 1,000,001 characters is refused message_too_long before any part leaves the client", async () => {
    const { owner, client, attach } = await attached();
    const sending = client.command(attach, { op: "prompt", text: "p".repeat(1_000_001) });
    expect(await rejectionOf(sending)).toMatchObject({
      code: "message_too_long",
      limit_chars: 1_000_000,
    });
    expect(owner.state.log.filter((t) => t.startsWith("session.command"))).toEqual([]);
  });

  test("a prompt of exactly 1,000,000 characters is accepted", async () => {
    const { owner, client, attach } = await attached();
    await client.command(attach, { op: "steer", text: "s".repeat(1_000_000) });
    expect(owner.state.log.filter((t) => t === "session.command_part")).toHaveLength(4);
  });
});
