// Vendored from sisyphuslabs/omo-relay-daemon@dab363aa3a9aa51936149d05b416310d429b61e0 packages/local-api/src/client-open.ts
import {
  EventAssembler,
  type ListingResult,
  type ListingRevision,
  type ReadPage,
} from "./client-assembly.ts";
import { ClientConnection, type DeadlineTimer, type RequestParams } from "./client-connection.ts";
import { LocalApiError } from "./errors.ts";
import { lineBytes, LOCAL_INLINE_MAX } from "./limits.ts";
import { clientProof, mintId, mintNonce, proofMatches, serverProof } from "./proof.ts";
import type {
  ClientInfo,
  CommandRpc,
  CommandTarget,
  DelegatedRoute,
  LocalEvent,
  RequestType,
  ResponseData,
  SessionFilter,
  Welcome,
} from "./protocol.ts";
import type { Transport } from "./transport.ts";
import { checkCommandText, MESSAGE_LIMIT_CHARS, uploadParts } from "./upload.ts";
import { validateWelcome } from "./validate.ts";
import { REQUEST_ID_MAX_CHARS } from "./validate-fields.ts";
import { LOCAL_API_VERSION } from "./vocabulary.ts";

// The local API client over any byte transport (#607): the hello, the owner's proof of the token, authenticate, then
// requests, events, commands with their upload parts, listings and reads. It reads no file, socket, process or Node
// global, so a page runs it over the browser device runtime's in-process transport; connectLocalApi (client.ts) is the
// Node and Bun wrapper that adds the state directory's access check, the token file and the local socket.

export type { ListingResult, ListingRevision, ReadPage, ReadPageEntry } from "./client-assembly.ts";
export type { DeadlineTimer, RequestParams } from "./client-connection.ts";

export type OpenOptions = {
  readonly client: ClientInfo;
  // Read after the owner's welcome, so a restarted owner's new token is the one proven.
  readonly readToken: () => Uint8Array;
  readonly handshakeTimer?: HandshakeTimer;
  readonly requestTimer?: DeadlineTimer;
};
// Arms `expire` to run after `ms` and returns its cancel; tests inject one to fire the expiry without waiting.
export type HandshakeTimer = DeadlineTimer;
export type ReadOptions = { readonly before_entry_id?: string; readonly tail?: number };
export type LocalApiClient = {
  readonly welcome: Welcome;
  readonly request: <T extends RequestType>(
    type: T,
    params: RequestParams<T>,
  ) => Promise<ResponseData[T]>;
  readonly onEvent: (listener: (event: LocalEvent) => void) => () => void;
  readonly command: (attach: string, rpc: CommandRpc, command_id?: string) => Promise<string>;
  /**
   * #393: a command to any target: `{attach}`, a device's engine endpoint `{device, endpoint}`, or a session by its id
   * `{session}` or its title `{alias}` (no attach). A one-string tool picks the last two with sessionTargetOf.
   * `route` (decision 0018) opts the command into the delegated channel or asks an open for its located key; it rides
   * the closing session.command only, never an upload part.
   */
  readonly commandTo: (
    target: CommandTarget,
    rpc: CommandRpc,
    command_id?: string,
    route?: DelegatedRoute,
  ) => Promise<string>;
  readonly list: (
    filter?: SessionFilter,
    onRevision?: (revision: ListingRevision) => void,
    /**
     * `rows: 2` asks for each row's kind and parent link (#316), `rows: 3` for those and its durable_id (#935); a
     * service before either answers invalid_request.
     */
    rows?: 2 | 3,
  ) => Promise<ListingResult>;
  readonly read: (attach: string, options?: ReadOptions) => Promise<ReadPage>;
  readonly oversizedLines: () => number;
  readonly close: () => void;
  readonly closed: Promise<void>;
};

// The whole handshake (welcome, proof check, authenticate answer) is bounded: an endpoint that accepts and never
// answers, such as another local user squatting a stale Windows port from endpoint.json, must not hang the client.
export const HANDSHAKE_TIMEOUT_MS = 10_000;
// Every request is bounded too: a request whose line or answer the owner drops settles as request_timeout instead of
// waiting for the connection to close. The connection stays open; the late answer, if any, is dropped.
export const REQUEST_TIMEOUT_MS = 30_000;

const realTimer: HandshakeTimer = (expire, ms) => {
  const timer = setTimeout(expire, ms);
  return () => clearTimeout(timer);
};

// The owner proves the per-boot token BEFORE the client sends anything but its hello: the token is read fresh after
// the welcome (a restarted owner wrote a new one) and a squatting server that cannot prove it gets nothing.
const proveAndAuthenticate = async (
  connection: ClientConnection,
  options: OpenOptions,
): Promise<Welcome> => {
  const nonce = mintNonce();
  connection.send({
    type: "hello",
    v: LOCAL_API_VERSION,
    client: options.client,
    client_nonce: nonce,
  });
  try {
    const welcome = validateWelcome(await connection.firstMessage());
    if (welcome.type === "refused") throw new LocalApiError("refused", welcome.reason);
    const token = options.readToken();
    if (!proofMatches(serverProof(token, nonce, connection.endpoint), welcome.server_proof))
      throw new LocalApiError("server_proof_invalid", "the owner did not prove the per-boot token");
    await connection.request("authenticate", {
      client_proof: clientProof(token, welcome.server_nonce, connection.endpoint),
    });
    return welcome;
  } catch (error) {
    connection.destroy();
    throw error;
  }
};

const handshake = (connection: ClientConnection, options: OpenOptions): Promise<Welcome> =>
  new Promise<Welcome>((resolve, reject) => {
    const cancel = (options.handshakeTimer ?? realTimer)(() => {
      connection.destroy();
      reject(new LocalApiError("handshake_timeout", "the owner did not complete the handshake"));
    }, HANDSHAKE_TIMEOUT_MS);
    proveAndAuthenticate(connection, options).then(resolve, reject).finally(cancel);
  });

const sendCommand = async (
  connection: ClientConnection,
  target: CommandTarget,
  rpc: CommandRpc,
  command_id: string | undefined,
  route: DelegatedRoute = {},
): Promise<string> => {
  // Always sent, minted here when the caller gave none: a command whose answer times out may still have been
  // dispatched, and its outcome arrives as session.command_state for this id. A retry of the same record to the same
  // target session under this id dispatches nothing more; anything else under it is command_id_conflict.
  const sent = command_id ?? mintId();
  const id = { command_id: sent };
  const timedOut = (error: unknown): never => {
    if (error instanceof LocalApiError && error.code === "request_timeout")
      throw new LocalApiError(
        "request_timeout",
        `command ${sent} may have been dispatched; follow its command state`,
        {
          command_id: sent,
        },
      );
    throw error;
  };
  const draft = {
    id: "x".repeat(REQUEST_ID_MAX_CHARS),
    type: "session.command",
    ...target,
    ...id,
    ...route,
    rpc,
  };
  if (lineBytes(draft) > LOCAL_INLINE_MAX) {
    // Too large for one line: the record's UTF-8 JSON goes as upload parts, held to the engine's own text limit.
    const json = JSON.stringify(rpc);
    if (checkCommandText(json) === "message_too_long")
      throw new LocalApiError("message_too_long", "the command is over the engine limit", {
        limit_chars: MESSAGE_LIMIT_CHARS,
      });
    const upload_id = mintId();
    const on = "device" in target ? { device: target.device } : target;
    const parts = uploadParts(json).map((part) =>
      connection.request("session.command_part", { ...on, upload_id, ...part }),
    );
    // A part that times out leaves session.command unsent, so the command was never dispatched: that timeout is
    // reported as it is, with no command_id, and a fresh retry is safe.
    await Promise.all(parts);
    return (
      await connection
        .request("session.command", { ...target, ...id, ...route, upload_id })
        .catch(timedOut)
    ).command_id;
  }
  return (
    await connection.request("session.command", { ...target, ...id, ...route, rpc }).catch(timedOut)
  ).command_id;
};

export const openLocalApiClient = async (
  transport: Transport,
  options: OpenOptions,
): Promise<LocalApiClient> => {
  const listeners = new Set<(event: LocalEvent) => void>();
  const assembler = new EventAssembler((event) => {
    for (const listener of [...listeners]) listener(event);
  });
  const connection = new ClientConnection(transport, (event) => assembler.accept(event), {
    timer: options.requestTimer ?? realTimer,
    ms: REQUEST_TIMEOUT_MS,
  });
  void connection.closed.then(() =>
    assembler.failAll(new LocalApiError("closed", "the connection closed")),
  );
  const welcome = await handshake(connection, options);
  return {
    welcome,
    request: (type, params) => connection.request(type, params),
    onEvent: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    command: (attach, rpc, command_id) => sendCommand(connection, { attach }, rpc, command_id),
    commandTo: (target, rpc, command_id, route) =>
      sendCommand(connection, target, rpc, command_id, route),
    list: (filter, onRevision, rows) =>
      new Promise<ListingResult>((resolve, reject) => {
        const params = {
          ...(filter === undefined ? {} : { filter }),
          ...(rows === undefined ? {} : { rows }),
        };
        const watch = (data: { readonly query_id: string }): void =>
          assembler.watchListing(data.query_id, { resolve, reject }, onRevision);
        connection.request("sessions.list", params, watch).catch(reject);
      }),
    read: (attach, options = {}) =>
      new Promise<ReadPage>((resolve, reject) => {
        const watch = (data: { readonly query_id: string }): void =>
          assembler.watchRead(data.query_id, attach, { resolve, reject });
        connection.request("session.read", { attach, ...options }, watch).catch(reject);
      }),
    oversizedLines: () => connection.oversizedLines(),
    close: () => connection.close(),
    closed: connection.closed,
  };
};
