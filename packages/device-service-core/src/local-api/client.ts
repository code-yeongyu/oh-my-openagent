import {
  checkPosixAccess,
  clientProof,
  mintId,
  mintNonce,
  proofMatches,
  readToken,
  serverProof,
} from "./access.ts";
import {
  EventAssembler,
  type ListingResult,
  type ListingRevision,
  type ReadPage,
} from "./client-assembly.ts";
import { ClientConnection, type DeadlineTimer, type RequestParams } from "./client-connection.ts";
import { LocalApiError } from "./errors.ts";
import { lineBytes, LOCAL_INLINE_MAX } from "./limits.ts";
import type {
  ClientInfo,
  CommandRequest,
  LocalEvent,
  RequestType,
  ResponseData,
  SessionFilter,
  Welcome,
} from "./protocol.ts";
import { connectLocal, type Transport } from "./transport.ts";
import { checkCommandText, MESSAGE_LIMIT_CHARS, uploadParts } from "./upload.ts";
import { validateWelcome } from "./validate.ts";
import { REQUEST_ID_MAX_CHARS } from "./validate-fields.ts";
import { LOCAL_API_VERSION } from "./vocabulary.ts";

export type { ListingResult, ListingRevision, ReadPage, ReadPageEntry } from "./client-assembly.ts";
export type { DeadlineTimer, RequestParams } from "./client-connection.ts";

export type ConnectOptions = {
  readonly stateDir: string;
  readonly client: ClientInfo;
  readonly readToken?: () => Uint8Array;
  readonly transport?: () => Promise<Transport>;
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
  readonly command: (
    attach: string,
    command: CommandRequest,
    command_id?: string,
  ) => Promise<string>;
  readonly list: (
    filter?: SessionFilter,
    onRevision?: (revision: ListingRevision) => void,
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
  options: ConnectOptions,
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
    const token = (options.readToken ?? (() => readToken(options.stateDir)))();
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

const handshake = (connection: ClientConnection, options: ConnectOptions): Promise<Welcome> =>
  new Promise<Welcome>((resolve, reject) => {
    const cancel = (options.handshakeTimer ?? realTimer)(() => {
      connection.destroy();
      reject(new LocalApiError("handshake_timeout", "the owner did not complete the handshake"));
    }, HANDSHAKE_TIMEOUT_MS);
    proveAndAuthenticate(connection, options).then(resolve, reject).finally(cancel);
  });

const sendCommand = async (
  connection: ClientConnection,
  attach: string,
  command: CommandRequest,
  command_id: string | undefined,
): Promise<string> => {
  // Always sent, minted here when the caller gave none: a command whose answer times out may still have been
  // dispatched, and its outcome arrives as session.command_state for this id. A retry of the same op and text to the
  // same target session under this id dispatches nothing more; anything else under it is command_id_conflict.
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
  if (command.op === "prompt" || command.op === "steer") {
    const verdict = checkCommandText(command.text);
    if (verdict === "message_too_long")
      throw new LocalApiError("message_too_long", "the text is over the engine limit", {
        limit_chars: MESSAGE_LIMIT_CHARS,
      });
    if (verdict === "malformed")
      throw new LocalApiError("invalid_request", "the text is not well-formed");
    const draft = {
      id: "x".repeat(REQUEST_ID_MAX_CHARS),
      type: "session.command",
      attach,
      ...id,
      command,
    };
    if (lineBytes(draft) > LOCAL_INLINE_MAX) {
      const upload_id = mintId();
      const parts = uploadParts(command.text).map((part) =>
        connection.request("session.command_part", { attach, upload_id, ...part }),
      );
      // A part that times out leaves session.command unsent, so the command was never dispatched: that timeout is
      // reported as it is, with no command_id, and a fresh retry is safe.
      await Promise.all(parts);
      return (
        await connection
          .request("session.command", { attach, ...id, upload_id, op: command.op })
          .catch(timedOut)
      ).command_id;
    }
  }
  return (await connection.request("session.command", { attach, ...id, command }).catch(timedOut))
    .command_id;
};

export const connectLocalApi = async (options: ConnectOptions): Promise<LocalApiClient> => {
  if (process.platform !== "win32") checkPosixAccess(options.stateDir);
  const transport = await (options.transport ?? (() => connectLocal(options.stateDir)))();
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
    command: (attach, command, command_id) => sendCommand(connection, attach, command, command_id),
    list: (filter, onRevision) =>
      new Promise<ListingResult>((resolve, reject) => {
        const params = filter === undefined ? {} : { filter };
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
