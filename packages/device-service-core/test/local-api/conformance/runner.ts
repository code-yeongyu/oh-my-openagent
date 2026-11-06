import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { clientProof } from "../../../src/local-api/access.ts";
import type { ClientInfo, JsonValue } from "../../../src/local-api/protocol.ts";
import { connectLocal } from "../../../src/local-api/transport.ts";
import {
  isRequestType,
  validateEvent,
  validateResponse,
  validateWelcome,
} from "../../../src/local-api/validate.ts";
import { startFakeOwner } from "./fake-owner.ts";
import { type Context, match, newContext, substitute } from "./patterns.ts";
import { PeerClosed, rawPeer, type RawPeer } from "./raw-peer.ts";
import { rejectionOf } from "./rejection.ts";
import { defaultWorld, type World } from "./world.ts";

// The conformance runner: generic JSON fixtures (fixtures/*.json) run against any server that can start from a
// World. Another server implementation registers the same suite with runConformance(itsTarget).
export type ConformanceServer = {
  readonly stateDir: string;
  readonly token: () => Uint8Array;
  readonly stop: () => Promise<void>;
};
export type ConformanceTarget = {
  readonly name: string;
  readonly start: (world: World) => Promise<ConformanceServer>;
};
export type Step =
  | { readonly send: JsonValue }
  | { readonly expect: JsonValue; readonly skip?: readonly string[] }
  | { readonly expect_closed: true };
export type FixtureCase = {
  readonly name: string;
  readonly outcome: "ok" | "refusal";
  readonly client?: ClientInfo;
  readonly handshake?: "full" | "welcome_only" | "none";
  readonly world?: Partial<World>;
  readonly steps: readonly Step[];
};
export type Fixture = { readonly request: string; readonly cases: readonly FixtureCase[] };

export const FIXTURE_DIR = join(import.meta.dir, "fixtures");
const CASE_MS = 30_000;
const DEFAULT_CLIENT: ClientInfo = { name: "omo", version: "2.0.0" };

export const loadFixtures = (): readonly Fixture[] =>
  readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith(".json"))
    .toSorted()
    .map((f): Fixture => JSON.parse(readFileSync(join(FIXTURE_DIR, f), "utf8")));

const field = (message: unknown, name: string): unknown =>
  typeof message === "object" && message !== null ? Reflect.get(message, name) : undefined;

// Every message a server writes must pass the strict validators; patterns are then matched against the message as
// it was written.
const validated = (message: unknown, ctx: Context): unknown => {
  const type = field(message, "type");
  if (type === "welcome" || type === "refused") {
    const welcome = validateWelcome(message);
    if (welcome.type === "welcome") ctx.serverNonce = welcome.server_nonce;
    return message;
  }
  if (type === "event") {
    validateEvent(message);
    return message;
  }
  const id = String(field(message, "id"));
  const requestType = ctx.types.get(id);
  if (requestType === undefined) throw new Error(`a response to id ${id}, which was never sent`);
  validateResponse(message, requestType);
  return message;
};

const nextValidated = async (
  peer: RawPeer,
  ctx: Context,
  skip: readonly string[],
): Promise<unknown> => {
  for (;;) {
    const message = validated(await peer.next(), ctx);
    const kind = field(message, "kind");
    if (typeof kind !== "string" || !skip.includes(kind)) return message;
  }
};

const runStep = async (peer: RawPeer, step: Step, ctx: Context): Promise<void> => {
  if ("send" in step) {
    const message = substitute(step.send, ctx);
    const id = field(message, "id");
    const type = field(message, "type");
    if (typeof id === "string" && isRequestType(type)) ctx.types.set(id, type);
    peer.send(message);
    return;
  }
  if ("expect" in step)
    return match(await nextValidated(peer, ctx, step.skip ?? []), step.expect, ctx, "message");
  expect(await rejectionOf(nextValidated(peer, ctx, []))).toBeInstanceOf(PeerClosed);
};

const runCase = async (target: ConformanceTarget, c: FixtureCase): Promise<void> => {
  const server = await target.start({ ...defaultWorld(), ...c.world });
  const peer = rawPeer(await connectLocal(server.stateDir));
  const ctx = newContext(server.token(), peer.endpoint);
  try {
    const mode = c.handshake ?? "full";
    if (mode !== "none") {
      const hello = {
        type: "hello",
        v: 1,
        client: c.client ?? DEFAULT_CLIENT,
        client_nonce: "<nonce>",
      };
      await runStep(peer, { send: hello }, ctx);
      await runStep(peer, { expect: { type: "welcome", server_proof: "<server_proof>" } }, ctx);
    }
    if (mode === "full") {
      await runStep(
        peer,
        { send: { id: "auth", type: "authenticate", client_proof: "<client_proof>" } },
        ctx,
      );
      await runStep(peer, { expect: { id: "auth", ok: true } }, ctx);
    }
    for (const step of c.steps) await runStep(peer, step, ctx);
  } finally {
    peer.close();
    await server.stop();
  }
};

const welcomed = async (peer: RawPeer, ctx: Context): Promise<void> => {
  await runStep(
    peer,
    { send: { type: "hello", v: 1, client: DEFAULT_CLIENT, client_nonce: "<nonce>" } },
    ctx,
  );
  await runStep(peer, { expect: { type: "welcome", server_proof: "<server_proof>" } }, ctx);
};

// Replay: every welcome carries a fresh server_nonce, so connection 1's accepted client_proof proves nothing on
// connection 2. An owner that reuses a nonce, or remembers proofs it accepted, fails here.
const runReplayCase = async (target: ConformanceTarget): Promise<void> => {
  const server = await target.start(defaultWorld());
  const first = rawPeer(await connectLocal(server.stateDir));
  const second = rawPeer(await connectLocal(server.stateDir));
  const one = newContext(server.token(), first.endpoint);
  const two = newContext(server.token(), second.endpoint);
  try {
    await welcomed(first, one);
    await welcomed(second, two);
    expect(two.serverNonce).not.toBe(one.serverNonce);
    await runStep(
      first,
      { send: { id: "auth", type: "authenticate", client_proof: "<client_proof>" } },
      one,
    );
    await runStep(first, { expect: { id: "auth", ok: true } }, one);
    const replayed = clientProof(one.token, one.serverNonce, one.endpoint);
    await runStep(
      second,
      { send: { id: "auth", type: "authenticate", client_proof: replayed } },
      two,
    );
    await runStep(
      second,
      {
        expect: {
          id: "auth",
          type: "response",
          ok: false,
          error: { code: "client_proof_invalid" },
        },
      },
      two,
    );
    await runStep(second, { expect_closed: true }, two);
  } finally {
    first.close();
    second.close();
    await server.stop();
  }
};

export const runConformance = (
  target: ConformanceTarget,
  fixtures: readonly Fixture[] = loadFixtures(),
): void => {
  describe(`local API conformance against ${target.name}`, () => {
    for (const fixture of fixtures)
      for (const c of fixture.cases)
        test(`${fixture.request}: ${c.name}`, () => runCase(target, c), CASE_MS);
    test(
      "authenticate: connection 1's client_proof replayed on connection 2 is refused and the connection closes",
      () => runReplayCase(target),
      CASE_MS,
    );
  });
};

export const fakeOwnerTarget: ConformanceTarget = {
  name: "FakeOwner",
  start: async (world) => {
    const stateDir = mkdtempSync(join(tmpdir(), "la-"));
    chmodSync(stateDir, 0o700);
    const owner = await startFakeOwner({ stateDir, world });
    return {
      stateDir,
      token: () => owner.token,
      stop: async () => {
        await owner.stop();
        rmSync(stateDir, { recursive: true, force: true });
      },
    };
  },
};
