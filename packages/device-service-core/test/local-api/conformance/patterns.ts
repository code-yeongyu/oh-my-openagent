import { generateKeyPairSync, randomBytes } from "node:crypto";
import { expect } from "bun:test";
import { clientProof, mintNonce, serverProof } from "../../../src/local-api/access.ts";
import type { JsonValue, RequestType } from "../../../src/local-api/protocol.ts";

// The fixture language. In a sent message: <nonce> mints the client nonce, <client_proof> and <wrong_proof> prove
// (or fail to prove) the token over the captured server nonce, <signing_key> and <sealing_key> are fresh PKCS#8
// keys, <ref:name> repeats a captured value. In an expected message: <any> is any present value, <capture:name>
// stores it, <ref:name> must equal a stored value, <server_proof> must prove the token over the sent nonce. Objects
// match by their listed fields; the strict validators have already pinned every other field.
export type Context = {
  readonly token: Uint8Array;
  readonly endpoint: string;
  readonly captures: Map<string, unknown>;
  readonly types: Map<string, RequestType>;
  readonly keys: { readonly signing: string; readonly sealing: string };
  nonce: string;
  serverNonce: string;
};

const pkcs8 = (kind: "ed25519" | "x25519"): string => {
  const pair = kind === "ed25519" ? generateKeyPairSync("ed25519") : generateKeyPairSync("x25519");
  return pair.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
};

export const newContext = (token: Uint8Array, endpoint: string): Context => ({
  token,
  endpoint,
  captures: new Map(),
  types: new Map(),
  keys: { signing: pkcs8("ed25519"), sealing: pkcs8("x25519") },
  nonce: "",
  serverNonce: "",
});

const tokenOf = (value: unknown): string | undefined =>
  typeof value === "string" && value.startsWith("<") && value.endsWith(">")
    ? value.slice(1, -1)
    : undefined;

export const substitute = (value: JsonValue, ctx: Context): JsonValue => {
  const name = tokenOf(value);
  if (name === "nonce") {
    ctx.nonce = mintNonce();
    return ctx.nonce;
  }
  if (name === "client_proof") return clientProof(ctx.token, ctx.serverNonce, ctx.endpoint);
  if (name === "wrong_proof") return clientProof(randomBytes(32), ctx.serverNonce, ctx.endpoint);
  if (name === "signing_key") return ctx.keys.signing;
  if (name === "sealing_key") return ctx.keys.sealing;
  if (name?.startsWith("ref:") === true)
    return JSON.parse(JSON.stringify(ctx.captures.get(name.slice(4))));
  if (Array.isArray(value)) return value.map((v) => substitute(v, ctx));
  if (typeof value === "object" && value !== null)
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v, ctx)]));
  return value;
};

const field = (actual: unknown, key: string): unknown =>
  typeof actual === "object" && actual !== null ? Reflect.get(actual, key) : undefined;

export const match = (actual: unknown, pattern: JsonValue, ctx: Context, path: string): void => {
  const name = tokenOf(pattern);
  if (name === "any") return void expect(actual, path).toBeDefined();
  if (name?.startsWith("capture:") === true) {
    expect(actual, path).toBeDefined();
    ctx.captures.set(name.slice(8), actual);
    return;
  }
  if (name?.startsWith("ref:") === true)
    return void expect(actual, path).toEqual(ctx.captures.get(name.slice(4)));
  if (name === "server_proof")
    return void expect(actual, path).toBe(serverProof(ctx.token, ctx.nonce, ctx.endpoint));
  if (name !== undefined) throw new Error(`unknown fixture token ${String(pattern)} at ${path}`);
  if (Array.isArray(pattern)) {
    expect(Array.isArray(actual) ? actual.length : -1, path).toBe(pattern.length);
    pattern.forEach((p, i) =>
      match(Array.isArray(actual) ? actual[i] : undefined, p, ctx, `${path}[${i}]`),
    );
    return;
  }
  if (typeof pattern === "object" && pattern !== null) {
    expect(typeof actual === "object" && actual !== null, path).toBe(true);
    for (const [key, p] of Object.entries(pattern))
      match(field(actual, key), p, ctx, `${path}.${key}`);
    return;
  }
  expect(actual, path).toEqual(pattern);
};
