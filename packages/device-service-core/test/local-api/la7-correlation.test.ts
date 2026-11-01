import { afterEach, describe, expect, test } from "bun:test";
import { writeToken } from "../../src/local-api/access.ts";
import { connectLocalApi, REQUEST_TIMEOUT_MS } from "../../src/local-api/client.ts";
import { LOCAL_INLINE_MAX } from "../../src/local-api/limits.ts";
import { uploadParts } from "../../src/local-api/upload.ts";
import type { LocalEvent } from "../../src/local-api/protocol.ts";
import { rejectionOf } from "./conformance/rejection.ts";
import { defaultWorld } from "./conformance/world.ts";
import {
  cleanup,
  freshStateDir,
  OMO,
  scriptServer,
  serveHandshake,
  testSecure,
} from "./support.ts";

afterEach(cleanup);

describe("LA7 correlation under interleaving", () => {
  test("three concurrent requests answered in reverse order between events each resolve with their own answer", async () => {
    const stateDir = freshStateDir();
    const token = await writeToken(stateDir, testSecure);
    const world = defaultWorld();
    await scriptServer(stateDir, async (peer) => {
      await serveHandshake(peer, token);
      const requests = [await peer.next(), await peer.next(), await peer.next()];
      const ids = requests.map((r) => Reflect.get(Object(r), "id"));
      const status = { type: "event", kind: "status.changed", status: world.status };
      peer.send(status);
      peer.send({ id: ids[2], type: "response", ok: true, data: { device: null } });
      peer.send(status);
      peer.send({ id: ids[1], type: "response", ok: true, data: { devices: world.devices } });
      peer.send({ id: ids[0], type: "response", ok: true, data: world.status });
    });
    const client = await connectLocalApi({ stateDir, client: OMO });
    const events: LocalEvent[] = [];
    client.onEvent((event) => events.push(event));
    const [status, devices, info] = await Promise.all([
      client.request("status.get", {}),
      client.request("devices.list", {}),
      client.request("device.info", {}),
    ]);
    expect(status).toEqual(world.status);
    expect(devices).toEqual({ devices: world.devices });
    expect(info).toEqual({ device: null });
    expect(events.map((e) => e.kind)).toEqual(["status.changed", "status.changed"]);
    client.close();
  });

  test("a response to an id that is not pending is a protocol violation that closes the client", async () => {
    const stateDir = freshStateDir();
    const token = await writeToken(stateDir, testSecure);
    await scriptServer(stateDir, async (peer) => {
      await serveHandshake(peer, token);
      await peer.next();
      peer.send({ id: "never-sent", type: "response", ok: true, data: {} });
    });
    const client = await connectLocalApi({ stateDir, client: OMO });
    expect(await rejectionOf(client.request("status.get", {}))).toMatchObject({
      code: "protocol_violation",
    });
    await client.closed;
  });
  test("a malformed response to a pending request rejects that request and every other one, and closes the client", async () => {
    const stateDir = freshStateDir();
    const token = await writeToken(stateDir, testSecure);
    await scriptServer(stateDir, async (peer) => {
      await serveHandshake(peer, token);
      const first = await peer.next();
      await peer.next();
      peer.send({
        id: Reflect.get(Object(first), "id"),
        type: "response",
        ok: false,
        error: { code: "unauthenticated", message: "not the error body shape" },
      });
    });
    const client = await connectLocalApi({ stateDir, client: OMO });
    const answered = client.request("status.get", {});
    const other = client.request("devices.list", {});
    expect(await rejectionOf(answered)).toMatchObject({ code: "protocol_violation" });
    expect(await rejectionOf(other)).toMatchObject({ code: "protocol_violation" });
    await client.closed;
  });
  test("a request the owner never answers settles as request_timeout; the connection stays usable and the late answer is dropped", async () => {
    const stateDir = freshStateDir();
    const token = await writeToken(stateDir, testSecure);
    const world = defaultWorld();
    let lateAnswer = (): void => {};
    const answeredLate = new Promise<void>((resolve) => {
      lateAnswer = resolve;
    });
    await scriptServer(stateDir, async (peer) => {
      await serveHandshake(peer, token);
      const ignored = await peer.next();
      const second = await peer.next();
      peer.send({
        id: Reflect.get(Object(second), "id"),
        type: "response",
        ok: true,
        data: world.status,
      });
      await answeredLate;
      peer.send({
        id: Reflect.get(Object(ignored), "id"),
        type: "response",
        ok: true,
        data: world.status,
      });
      const third = await peer.next();
      peer.send({
        id: Reflect.get(Object(third), "id"),
        type: "response",
        ok: true,
        data: world.status,
      });
    });
    const timers: { readonly expire: () => void; readonly ms: number; cancelled: boolean }[] = [];
    const client = await connectLocalApi({
      stateDir,
      client: OMO,
      requestTimer: (expire, ms) => {
        const timer = { expire, ms, cancelled: false };
        timers.push(timer);
        return () => {
          timer.cancelled = true;
        };
      },
    });
    const ignored = client.request("status.get", {});
    expect(await client.request("status.get", {})).toEqual(world.status);
    // Every answered request cancelled its deadline; only the unanswered one is still armed.
    const armed = timers.filter((timer) => !timer.cancelled);
    expect(armed).toHaveLength(1);
    armed[0]?.expire();
    expect(await rejectionOf(ignored)).toMatchObject({ code: "request_timeout" });
    expect(timers.every((timer) => timer.ms === REQUEST_TIMEOUT_MS)).toBe(true);
    lateAnswer();
    expect(await client.request("status.get", {})).toEqual(world.status);
    expect(client.oversizedLines()).toBe(0);
    client.close();
  });

  test("a session.command that times out reports the command_id it was sent under, so its outcome can still be followed", async () => {
    const stateDir = freshStateDir();
    const token = await writeToken(stateDir, testSecure);
    let sent: unknown;
    let heard = (): void => {};
    const commandSent = new Promise<void>((resolve) => {
      heard = resolve;
    });
    await scriptServer(stateDir, async (peer) => {
      await serveHandshake(peer, token);
      sent = await peer.next();
      heard();
      await peer.closed;
    });
    const armed: (() => void)[] = [];
    const client = await connectLocalApi({
      stateDir,
      client: OMO,
      requestTimer: (expire) => {
        armed.push(expire);
        return () => {};
      },
    });
    const commanding = client.command("attach-1", { op: "abort" });
    await commandSent;
    armed[armed.length - 1]?.();
    const failure = await rejectionOf(commanding);
    const commandId = Reflect.get(Object(sent), "command_id");
    expect(typeof commandId).toBe("string");
    expect(failure).toMatchObject({ code: "request_timeout", command_id: commandId });
    client.close();
  });
  test("an upload part that times out is a plain request_timeout: session.command was never sent, so no command_id", async () => {
    const stateDir = freshStateDir();
    const token = await writeToken(stateDir, testSecure);
    let partHeard = (): void => {};
    const heardPart = new Promise<void>((resolve) => {
      partHeard = resolve;
    });
    const { received } = await scriptServer(stateDir, async (peer) => {
      await serveHandshake(peer, token);
      await peer.next();
      partHeard();
      await peer.closed;
    });
    const armed: (() => void)[] = [];
    const client = await connectLocalApi({
      stateDir,
      client: OMO,
      requestTimer: (expire) => {
        armed.push(expire);
        return () => {};
      },
    });
    const armedBeforeCommand = armed.length;
    const text = "x".repeat(LOCAL_INLINE_MAX);
    const commanding = client.command("attach-1", { op: "prompt", text });
    await heardPart;
    const partTimers = armed.slice(armedBeforeCommand);
    for (const expire of partTimers) expire();
    const failure = await rejectionOf(commanding);
    client.close();
    const sessionFrames = (await received)
      .map((message) => String(Reflect.get(Object(message), "type")))
      .filter((type) => type.startsWith("session."));
    const expectedParts = uploadParts(text).length;
    expect(expectedParts).toBeGreaterThan(1);
    expect(sessionFrames).toEqual(Array(expectedParts).fill("session.command_part"));
    expect(partTimers).toHaveLength(expectedParts);
    expect(failure).toMatchObject({ code: "request_timeout" });
    expect(Reflect.get(Object(failure), "command_id")).toBeUndefined();
  });
});
