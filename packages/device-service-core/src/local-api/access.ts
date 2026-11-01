import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  chmodSync,
  closeSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { LocalApiError } from "./errors.ts";

export { applyExactDacl, verifyExactDacl, windowsSecureFile } from "./dacl.ts";

// The access contract (docs/local-api.md "Access"): a private state dir, and a 32-byte per-boot token in
// <state dir>/token that both sides prove with HMAC-SHA256 before any request is honored.
export const TOKEN_FILE = "token";
export const TOKEN_BYTES = 32;
export const NONCE_BYTES = 32;
export const SOCKET_FILE = "service.sock";

// Applies and verifies the platform protection of one state dir entry; throws insecure_state_dir when it cannot.
export type SecureFile = (path: string, kind: "dir" | "file" | "socket") => Promise<void>;

const base64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");
export const mintNonce = (): string => base64url(randomBytes(NONCE_BYTES));
export const mintId = (): string => base64url(randomBytes(16));

const insecure = (detail: string): never => {
  throw new LocalApiError("insecure_state_dir", detail);
};

const decoded = (value: string, bytes: number, what: string): Uint8Array => {
  const out = Buffer.from(value, "base64url");
  if (out.length !== bytes || base64url(out) !== value)
    throw new LocalApiError("protocol_violation", `${what} is not ${bytes} base64url bytes`);
  return out;
};

// The endpoint both proofs are bound to: `tcp:<port>` for the Windows loopback listener (the owner's listening port;
// for a client, the port it read from endpoint.json and connected to), `unix` for the POSIX socket in the private
// state dir. A forwarder through a squatted old port proves the wrong endpoint on both sides.
export const UNIX_ENDPOINT = "unix";
export const tcpEndpoint = (port: number): string => `tcp:${port}`;

// HMAC-SHA256(token, label || nonce (32 raw bytes) || UTF-8 endpoint); the label and nonce are fixed-length.
const proof = (
  token: Uint8Array,
  label: "server" | "client",
  nonce: string,
  endpoint: string,
): string =>
  base64url(
    createHmac("sha256", token)
      .update(label)
      .update(decoded(nonce, NONCE_BYTES, "a nonce"))
      .update(endpoint, "utf8")
      .digest(),
  );
export const serverProof = (token: Uint8Array, clientNonce: string, endpoint: string): string =>
  proof(token, "server", clientNonce, endpoint);
export const clientProof = (token: Uint8Array, serverNonce: string, endpoint: string): string =>
  proof(token, "client", serverNonce, endpoint);
export const proofMatches = (expected: string, actual: string): boolean => {
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
};

const isMissing = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error.code === "ENOENT" || error.code === "ENOTDIR");

const currentUid = (): number => process.getuid?.() ?? insecure("this platform has no uid");

// POSIX: the entry exists as itself (lstat: a symlink fails), belongs to this uid and has no group or world bits.
const privateEntry = (
  path: string,
  kind: "dir" | "file" | "socket",
  uid: number,
  checkMode = true,
): void => {
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if (isMissing(error)) return insecure(`the ${kind} is missing`);
    throw error;
  }
  const isKind =
    kind === "dir" ? stat.isDirectory() : kind === "socket" ? stat.isSocket() : stat.isFile();
  if (!isKind) insecure(`the ${kind} is not a plain ${kind}`);
  if (stat.uid !== uid) insecure(`the ${kind} belongs to another user`);
  if (checkMode && (stat.mode & 0o077) !== 0) insecure(`the ${kind} is open to group or others`);
};

export const checkPosixAccess = (stateDir: string): void => {
  const uid = currentUid();
  privateEntry(stateDir, "dir", uid);
  privateEntry(join(stateDir, SOCKET_FILE), "socket", uid);
  privateEntry(join(stateDir, TOKEN_FILE), "file", uid);
};

// The entry is checked as itself and as this uid's BEFORE chmod: chmod follows a symlink, and on another user's entry
// it would throw a raw EPERM instead of insecure_state_dir.
export const posixSecureFile: SecureFile = async (path, kind) => {
  const uid = currentUid();
  privateEntry(path, kind, uid, false);
  chmodSync(path, kind === "dir" ? 0o700 : 0o600);
  privateEntry(path, kind, uid);
};

export const readToken = (stateDir: string): Uint8Array => {
  let value: string;
  try {
    value = readFileSync(join(stateDir, TOKEN_FILE), "utf8");
  } catch (error) {
    if (isMissing(error)) return insecure("the token is missing");
    throw error;
  }
  try {
    return decoded(value, TOKEN_BYTES, "the token");
  } catch (error) {
    if (error instanceof LocalApiError) return insecure("the token is malformed");
    throw error;
  }
};

// The secret is written only after the empty file passed `secure`, then renamed into place: a reader never sees a
// partial or unprotected secret, and a failed protection leaves no file behind.
export const writeSecretFile = async (
  path: string,
  content: string,
  secure: SecureFile,
): Promise<void> => {
  const temp = `${path}.${mintId()}.tmp`;
  closeSync(openSync(temp, "wx", 0o600));
  try {
    await secure(temp, "file");
    writeFileSync(temp, content);
    renameSync(temp, path);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
};

export const writeToken = async (stateDir: string, secure: SecureFile): Promise<Uint8Array> => {
  await secure(stateDir, "dir");
  const token = new Uint8Array(randomBytes(TOKEN_BYTES));
  await writeSecretFile(join(stateDir, TOKEN_FILE), base64url(token), secure);
  return token;
};
