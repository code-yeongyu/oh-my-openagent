// Vendored from sisyphuslabs/omo-relay-daemon@dab363aa3a9aa51936149d05b416310d429b61e0 packages/local-api/src/client.ts
import { checkPosixAccess, readToken } from "./access.ts";
import { type HandshakeTimer, type LocalApiClient, openLocalApiClient } from "./client-open.ts";
import type { DeadlineTimer } from "./client-connection.ts";
import type { ClientInfo } from "./protocol.ts";
import { connectLocal, type Transport } from "./transport.ts";

export {
  HANDSHAKE_TIMEOUT_MS,
  REQUEST_TIMEOUT_MS,
  type HandshakeTimer,
  type ListingResult,
  type ListingRevision,
  type LocalApiClient,
  type OpenOptions,
  type ReadOptions,
  type ReadPage,
  type ReadPageEntry,
} from "./client-open.ts";
export type { DeadlineTimer, RequestParams } from "./client-connection.ts";

export type ConnectOptions = {
  readonly stateDir: string;
  readonly client: ClientInfo;
  readonly readToken?: () => Uint8Array;
  readonly transport?: () => Promise<Transport>;
  readonly handshakeTimer?: HandshakeTimer;
  readonly requestTimer?: DeadlineTimer;
};

// The Node and Bun client: the state directory's access check, the local socket and the per-boot token file around
// the transport-neutral client (client-open.ts).
export const connectLocalApi = async (options: ConnectOptions): Promise<LocalApiClient> => {
  if (process.platform !== "win32") checkPosixAccess(options.stateDir);
  const transport = await (options.transport ?? (() => connectLocal(options.stateDir)))();
  return openLocalApiClient(transport, {
    client: options.client,
    readToken: options.readToken ?? (() => readToken(options.stateDir)),
    ...(options.handshakeTimer === undefined ? {} : { handshakeTimer: options.handshakeTimer }),
    ...(options.requestTimer === undefined ? {} : { requestTimer: options.requestTimer }),
  });
};
