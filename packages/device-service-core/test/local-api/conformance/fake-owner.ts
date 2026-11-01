import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  clientProof,
  mintId,
  mintNonce,
  posixSecureFile,
  proofMatches,
  serverProof,
  writeToken,
  type SecureFile,
} from "../../../src/local-api/access.ts";
import { LocalApiError } from "../../../src/local-api/errors.ts";
import { encodeLine, LineDecoder, parseLine } from "../../../src/local-api/framing.ts";
import {
  CAPABILITIES,
  type ClientInfo,
  type ErrorCode,
  type JsonObject,
} from "../../../src/local-api/protocol.ts";
import { listenLocal, type LocalListener, type Transport } from "../../../src/local-api/transport.ts";
import { UploadAssembler } from "../../../src/local-api/upload.ts";
import { validateHello, validateRequest } from "../../../src/local-api/validate.ts";
import { dispatch } from "./fake-owner-handlers.ts";
import type { Conn, OwnerState } from "./fake-owner-state.ts";
import type { World } from "./world.ts";

// The reference owner the conformance fixtures run against: every request of the vocabulary over a real local
// socket, with the mutual proof, chunked payloads and paged listings. It is a test double for the server the device
// service binds; state comes from a World, never from a real account.
export type FakeOwner = {
  readonly stateDir: string;
  readonly token: Uint8Array;
  readonly state: OwnerState;
  readonly connections: () => number;
  readonly stop: () => Promise<void>;
};
export type FakeOwnerOptions = {
  readonly stateDir: string;
  readonly world: World;
  readonly secure?: SecureFile;
  readonly now?: () => number;
};

const noopSecure: SecureFile = async () => {};

export const errorReply = (
  id: string,
  code: ErrorCode,
  reason: string,
  extra: JsonObject = {},
): JsonObject => ({
  id,
  type: "response",
  ok: false,
  error: { code, reason, action: null, ...extra },
});

const readEnabled = (stateDir: string): boolean | undefined => {
  const path = join(stateDir, "config.json");
  if (!existsSync(path)) return undefined;
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  return typeof parsed === "object" && parsed !== null && "enabled" in parsed
    ? parsed.enabled === true
    : undefined;
};

export const startFakeOwner = async (options: FakeOwnerOptions): Promise<FakeOwner> => {
  const secure = options.secure ?? (process.platform === "win32" ? noopSecure : posixSecureFile);
  const token = await writeToken(options.stateDir, secure);
  const enabled = readEnabled(options.stateDir) ?? options.world.status.enabled;
  const status = enabled
    ? options.world.status
    : { ...options.world.status, enabled: false, state: "disabled" as const };
  const state: OwnerState = {
    stateDir: options.stateDir,
    world: options.world,
    status,
    conns: new Set(),
    log: [],
    adoptions: 0,
    attaches: new Map(),
    bindings: new Map(),
    commands: [],
    uploads: new UploadAssembler(),
    endpoints: new Set(),
    reports: [],
    refresher: null,
    now: options.now ?? Date.now,
    mint: mintId,
    stop: async () => {},
  };
  let listener: LocalListener | undefined;
  const serve = (transport: Transport): void => {
    let phase: "hello" | "proof" | "ready" = "hello";
    let client: ClientInfo | undefined;
    let serverNonce = "";
    const send = (message: unknown): void => transport.write(encodeLine(message));
    const conn: Conn = {
      send,
      close: () => transport.close(),
      attaches: new Set(),
      subscribed: false,
      client: () => client,
    };
    state.conns.add(conn);
    transport.onClose(() => {
      state.conns.delete(conn);
      for (const attach of conn.attaches) state.attaches.delete(attach);
    });
    const onMessage = (message: unknown): void => {
      if (phase === "hello") {
        const hello = validateHello(message);
        if (!hello.ok) {
          send({ type: "refused", reason: hello.reason });
          transport.close();
          return;
        }
        client = hello.hello.client;
        serverNonce = mintNonce();
        send({
          type: "welcome",
          v: 1,
          service_version: state.world.service_version,
          owner: "service",
          server_proof: serverProof(token, hello.hello.client_nonce, transport.endpoint),
          server_nonce: serverNonce,
          capabilities: [...CAPABILITIES],
          state: state.status,
        });
        phase = "proof";
        return;
      }
      const parsed = validateRequest(message);
      if (!parsed.ok) {
        if (parsed.id !== null) send(errorReply(parsed.id, parsed.code, parsed.reason));
        return;
      }
      const request = parsed.request;
      if (phase === "proof") {
        if (request.type !== "authenticate") {
          send(errorReply(request.id, "unauthenticated", "authenticate first"));
          return;
        }
        if (
          !proofMatches(clientProof(token, serverNonce, transport.endpoint), request.client_proof)
        ) {
          send(errorReply(request.id, "client_proof_invalid", "client proof does not verify"));
          transport.close();
          return;
        }
        phase = "ready";
        send({ id: request.id, type: "response", ok: true, data: {} });
        return;
      }
      const outcome = dispatch(state, conn, request);
      send(
        "error" in outcome.reply
          ? errorReply(
              request.id,
              outcome.reply.error.code,
              outcome.reply.error.reason,
              outcome.reply.error.extra ?? {},
            )
          : { id: request.id, type: "response", ok: true, data: outcome.reply.data },
      );
      outcome.after?.();
    };
    const decoder = new LineDecoder(
      (line) => {
        let message: unknown;
        try {
          message = parseLine(line);
        } catch (error) {
          if (!(error instanceof LocalApiError)) throw error;
          if (phase === "hello") {
            send({ type: "refused", reason: "malformed" });
            transport.close();
          }
          return;
        }
        onMessage(message);
      },
      () => {},
    );
    transport.onData((bytes) => decoder.push(bytes));
  };
  listener = await listenLocal(options.stateDir, serve, secure);
  state.stop = async () => {
    for (const conn of state.conns) conn.close();
    await listener?.close();
  };
  return {
    stateDir: options.stateDir,
    token,
    state,
    connections: () => listener?.accepted() ?? 0,
    stop: () => state.stop(),
  };
};
