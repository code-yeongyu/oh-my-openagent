import { generateKeyPairSync } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clientProof,
  mintNonce,
  posixSecureFile,
  proofMatches,
  serverProof,
  SOCKET_FILE,
  tcpEndpoint,
  UNIX_ENDPOINT,
  writeSecretFile,
  type SecureFile,
} from "../../src/local-api/access.ts";
import { connectLocalApi, type LocalApiClient } from "../../src/local-api/client.ts";
import {
  CAPABILITIES,
  type ClientInfo,
  type ListingRow,
  type LocalEvent,
} from "../../src/local-api/protocol.ts";
import {
  connectLocal,
  ENDPOINT_FILE,
  listenLocal,
  type LocalListener,
  type Transport,
} from "../../src/local-api/transport.ts";
import { startFakeOwner, type FakeOwner } from "./conformance/fake-owner.ts";
import { PeerClosed, rawPeer, type RawPeer } from "./conformance/raw-peer.ts";
import { defaultWorld, type World } from "./conformance/world.ts";

export const OMO: ClientInfo = { name: "omo", version: "2.0.0" };
export const INSTALLER: ClientInfo = { name: "installer", version: "2.0.0" };
export const desktop = (data_home: string): ClientInfo => ({
  name: "desktop",
  version: "2.0.0",
  data_home,
});
export const WAIT_MS = 10_000;
// The POSIX owner-and-mode check where it applies; on Windows the exact DACL is LA17's subject, not every test's.
export const testSecure: SecureFile =
  process.platform === "win32" ? async () => {} : posixSecureFile;

const dirs: string[] = [];
const owners: FakeOwner[] = [];
const closers: (() => void)[] = [];
const listeners: LocalListener[] = [];

// A short prefix keeps <state dir>/service.sock under the 104-byte Unix socket path limit of macOS.
export const freshStateDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "la-"));
  chmodSync(dir, 0o700);
  dirs.push(dir);
  return dir;
};

export const startOwner = async (
  world: World = defaultWorld(),
  stateDir: string = freshStateDir(),
): Promise<FakeOwner> => {
  const owner = await startFakeOwner({ stateDir, world });
  owners.push(owner);
  return owner;
};

export const connectClient = async (
  owner: FakeOwner,
  client: ClientInfo = OMO,
): Promise<LocalApiClient> => {
  const connected = await connectLocalApi({ stateDir: owner.stateDir, client });
  closers.push(() => connected.close());
  return connected;
};

export const rawConnect = async (stateDir: string): Promise<RawPeer> => {
  const peer = rawPeer(await connectLocal(stateDir));
  closers.push(() => peer.close());
  return peer;
};

export const helloFrom = (client: ClientInfo, client_nonce: string = mintNonce()) => ({
  type: "hello",
  v: 1,
  client,
  client_nonce,
});

const field = (message: unknown, name: string): unknown => {
  if (typeof message !== "object" || message === null) return undefined;
  const value: unknown = Reflect.get(message, name);
  return value;
};

export const rawHandshake = async (
  peer: RawPeer,
  token: Uint8Array,
  client: ClientInfo = OMO,
): Promise<unknown> => {
  peer.send(helloFrom(client));
  const welcome = await peer.next();
  peer.send({
    id: "auth",
    type: "authenticate",
    client_proof: clientProof(token, String(field(welcome, "server_nonce")), peer.endpoint),
  });
  await peer.next();
  return welcome;
};

export const listenRaw = async (
  stateDir: string,
  onPeer: (peer: RawPeer) => void,
): Promise<void> => {
  listeners.push(
    await listenLocal(stateDir, (transport) => onPeer(rawPeer(transport)), testSecure),
  );
};

// Runs `script` as the server of the next connection; `received` resolves with every message it received once the
// client closed. It is wrapped in an object because an async function returning a promise would wait for it.
export const scriptServer = async (
  stateDir: string,
  script: (peer: RawPeer) => Promise<void>,
): Promise<{ readonly received: Promise<readonly unknown[]> }> => {
  let done = (_received: readonly unknown[]): void => {};
  const received = new Promise<readonly unknown[]>((resolve) => {
    done = resolve;
  });
  await listenRaw(stateDir, (peer) => {
    void (async () => {
      try {
        await script(peer);
      } catch (error) {
        if (!(error instanceof PeerClosed)) throw error;
      }
      await peer.closed;
      done([...peer.received]);
    })();
  });
  return { received };
};

// A hostile endpoint that never sends FIN: allowHalfOpen keeps its side open after the client's FIN, so only a
// client that destroys its socket (rather than half-closing it with end()) sees the connection end.
export const halfOpenServer = async (
  stateDir: string,
  script: (peer: RawPeer) => Promise<void>,
): Promise<void> => {
  const sockets = new Set<Socket>();
  let endpoint = UNIX_ENDPOINT;
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    const transport: Transport = {
      endpoint,
      write: (bytes) => void socket.write(bytes),
      close: () => {},
      destroy: () => {},
      onData: (listener) =>
        void socket.on("data", (chunk: Buffer) =>
          listener(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)),
        ),
      onClose: (listener) => void socket.on("close", listener),
    };
    void script(rawPeer(transport)).catch((error: unknown) => {
      if (!(error instanceof PeerClosed)) throw error;
    });
  });
  await new Promise<void>((resolve) => {
    if (process.platform === "win32") server.listen({ host: "127.0.0.1", port: 0 }, resolve);
    else server.listen({ path: join(stateDir, SOCKET_FILE) }, resolve);
  });
  const address = server.address();
  if (typeof address === "object" && address !== null) {
    endpoint = tcpEndpoint(address.port);
    await writeSecretFile(
      join(stateDir, ENDPOINT_FILE),
      JSON.stringify({ port: address.port }),
      testSecure,
    );
  } else await testSecure(join(stateDir, SOCKET_FILE), "socket");
  closers.push(() => {
    for (const socket of sockets) socket.destroy();
    server.close();
  });
};

export const typeOf = (message: unknown): unknown => field(message, "type");

export const serveHandshake = async (peer: RawPeer, token: Uint8Array): Promise<void> => {
  const hello = await peer.next();
  const server_nonce = mintNonce();
  peer.send({
    type: "welcome",
    v: 1,
    service_version: "1.4.0",
    owner: "service",
    server_proof: serverProof(token, String(field(hello, "client_nonce")), peer.endpoint),
    server_nonce,
    capabilities: [...CAPABILITIES],
    state: defaultWorld().status,
  });
  const auth = await peer.next();
  const verified = proofMatches(
    clientProof(token, server_nonce, peer.endpoint),
    String(field(auth, "client_proof")),
  );
  peer.send({
    id: field(auth, "id"),
    type: "response",
    ok: verified,
    ...(verified ? { data: {} } : {}),
  });
};

// Resolves with the first event the predicate accepts; subscribe BEFORE triggering the action.
export const nextEvent = <E extends LocalEvent>(
  client: LocalApiClient,
  accept: (event: LocalEvent) => event is E,
): Promise<E> =>
  new Promise<E>((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error(`no matching event within ${WAIT_MS} ms`));
    }, WAIT_MS);
    const off = client.onEvent((event) => {
      if (!accept(event)) return;
      clearTimeout(timer);
      off();
      resolve(event);
    });
  });

export const ofKind =
  <K extends LocalEvent["kind"]>(kind: K) =>
  (event: LocalEvent): event is Extract<LocalEvent, { kind: K }> =>
    event.kind === kind;

export const deviceKeys = () => ({
  signing: generateKeyPairSync("ed25519")
    .privateKey.export({ format: "der", type: "pkcs8" })
    .toString("base64"),
  sealing: generateKeyPairSync("x25519")
    .privateKey.export({ format: "der", type: "pkcs8" })
    .toString("base64"),
});

// The plan verifier's listing: 1,000 rows at the session-list contract's field bounds whose one-line
// sessions.listing_rows encoding (22-character query_id, revision 1) is exactly 1,535,973 bytes.
export const verifierListing = (): readonly ListingRow[] =>
  Array.from({ length: 1000 }, (_, i) => ({
    device: `device-${String(i % 7).padStart(2, "0")}-0123456789abcdef0123456789`,
    session_id: `c2Vzc2lvbi1rZXktMD${String(i).padStart(4, "0")}`,
    title: `Session ${String(i).padStart(4, "0")} ${"t".repeat(231 + (i < 32 ? 1 : 0))}`,
    project: `project-${"p".repeat(56)}`,
    path: `/home/user/projects/${"x".repeat(1004)}`,
    state: (["running", "idle", "ended"] as const)[i % 3] ?? "running",
    updated_ms: 1_790_000_000_000 + i,
    source: i % 2 === 0 ? "live" : "cache",
    as_of: 1_790_000_100_000 + i,
  }));

export const cleanup = async (): Promise<void> => {
  for (const close of closers.splice(0)) close();
  for (const owner of owners.splice(0)) await owner.stop();
  for (const listener of listeners.splice(0)) await listener.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
};
