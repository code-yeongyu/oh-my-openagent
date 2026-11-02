import { lstatSync, readFileSync, unlinkSync } from "node:fs";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";
import {
  SOCKET_FILE,
  tcpEndpoint,
  UNIX_ENDPOINT,
  writeSecretFile,
  type SecureFile,
} from "./access.ts";
import { LocalApiError } from "./errors.ts";

// The byte transport: a Unix socket <state dir>/service.sock on POSIX; on Windows a loopback TCP listener whose
// ephemeral port is recorded in <state dir>/endpoint.json.
export const ENDPOINT_FILE = "endpoint.json";

// `close` half-closes (end) for an orderly goodbye; `destroy` tears the socket down at once, for failures, so a peer
// that never sends FIN cannot keep it alive. `endpoint` is what the mutual proof is bound to.
export type Transport = {
  readonly endpoint: string;
  readonly write: (bytes: Uint8Array) => void;
  readonly close: () => void;
  readonly destroy: () => void;
  readonly onData: (listener: (bytes: Uint8Array) => void) => void;
  readonly onClose: (listener: () => void) => void;
};
export type LocalListener = {
  readonly close: () => Promise<void>;
  readonly accepted: () => number;
};

const wrap = (socket: Socket, endpoint: string): Transport => {
  const closeListeners: (() => void)[] = [];
  let closed = false;
  socket.on("close", () => {
    closed = true;
    for (const listener of closeListeners.splice(0)) listener();
  });
  // Node emits 'close' after every socket error; the close listeners are how a transport reports its end.
  socket.on("error", () => {});
  return {
    endpoint,
    write: (bytes) => {
      if (!closed) socket.write(bytes);
    },
    close: () => {
      socket.end();
    },
    destroy: () => {
      socket.destroy();
    },
    onData: (listener) => {
      socket.on("data", (chunk: Buffer) =>
        listener(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)),
      );
    },
    onClose: (listener) => {
      if (closed) listener();
      else closeListeners.push(listener);
    },
  };
};

const listen = (
  server: Server,
  options: { readonly path: string } | { readonly host: string; readonly port: number },
) =>
  new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options, () => {
      server.off("error", reject);
      resolve();
    });
  });

// A socket file left by a crashed owner is replaced; anything else at that path is refused.
const removeStaleSocket = (path: string): void => {
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")
      return;
    throw error;
  }
  if (!stat.isSocket())
    throw new LocalApiError("insecure_state_dir", "the socket path holds something else");
  unlinkSync(path);
};

export const readEndpointPort = (stateDir: string): number => {
  const parsed: unknown = JSON.parse(readFileSync(join(stateDir, ENDPOINT_FILE), "utf8"));
  const port: unknown =
    typeof parsed === "object" && parsed !== null ? Reflect.get(parsed, "port") : undefined;
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65_535)
    throw new LocalApiError("insecure_state_dir", "endpoint.json holds no port");
  return port;
};

export const listenLocal = async (
  stateDir: string,
  onConnection: (transport: Transport) => void,
  secure: SecureFile,
): Promise<LocalListener> => {
  let accepted = 0;
  const sockets = new Set<Socket>();
  let endpoint = UNIX_ENDPOINT;
  const server = createServer((socket) => {
    accepted += 1;
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    onConnection(wrap(socket, endpoint));
  });
  if (process.platform === "win32") {
    await listen(server, { host: "127.0.0.1", port: 0 });
    const address = server.address();
    if (typeof address !== "object" || address === null)
      throw new LocalApiError("internal", "no loopback port");
    endpoint = tcpEndpoint(address.port);
    await writeSecretFile(
      join(stateDir, ENDPOINT_FILE),
      JSON.stringify({ port: address.port }),
      secure,
    );
  } else {
    const path = join(stateDir, SOCKET_FILE);
    removeStaleSocket(path);
    await listen(server, { path });
    await secure(path, "socket");
  }
  return {
    accepted: () => accepted,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        for (const socket of sockets) socket.destroy();
      }),
  };
};

export const connectLocal = (stateDir: string): Promise<Transport> =>
  new Promise((resolve, reject) => {
    const port = process.platform === "win32" ? readEndpointPort(stateDir) : undefined;
    const endpoint = port === undefined ? UNIX_ENDPOINT : tcpEndpoint(port);
    const socket =
      port === undefined
        ? createConnection({ path: join(stateDir, SOCKET_FILE) })
        : createConnection({ host: "127.0.0.1", port });
    socket.once("error", reject);
    socket.once("connect", () => {
      socket.off("error", reject);
      resolve(wrap(socket, endpoint));
    });
  });
