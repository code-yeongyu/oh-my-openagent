// libsodium's crypto_box_seal in pure TypeScript, the encryption GitHub requires for a secret value.
import { createPrivateKey, createPublicKey, diffieHellman } from "node:crypto";
import { blake2b } from "./blake2b.ts";
import { poly1305 } from "./poly1305.ts";
import { hsalsa20, xsalsa20 } from "./salsa20.ts";

const KEY_BYTES = 32;
const PKCS8_X25519 = Buffer.from("302e020100300506032b656e04220420", "hex");
const SPKI_X25519 = Buffer.from("302a300506032b656e032100", "hex");

const privateKey = (secret: Uint8Array) =>
  createPrivateKey({
    key: Buffer.concat([PKCS8_X25519, secret]),
    format: "der",
    type: "pkcs8",
  });

const publicKey = (raw: Uint8Array) =>
  createPublicKey({
    key: Buffer.concat([SPKI_X25519, raw]),
    format: "der",
    type: "spki",
  });

const rawPublicKey = (secret: Uint8Array): Uint8Array =>
  new Uint8Array(
    createPublicKey(privateKey(secret))
      .export({ format: "der", type: "spki" })
      .subarray(SPKI_X25519.length),
  );

/** crypto_box_easy: XSalsa20-Poly1305 under the HSalsa20 of the X25519 shared secret; output is MAC || ciphertext. */
const boxEasy = (
  message: Uint8Array,
  nonce: Uint8Array,
  recipient: Uint8Array,
  secret: Uint8Array,
): Uint8Array => {
  const shared = diffieHellman({
    privateKey: privateKey(secret),
    publicKey: publicKey(recipient),
  });
  const key = hsalsa20(new Uint8Array(shared), new Uint8Array(16));
  const padded = new Uint8Array(KEY_BYTES + message.length);
  padded.set(message, KEY_BYTES);
  const stream = xsalsa20(key, nonce, padded);
  const ciphertext = stream.subarray(KEY_BYTES);
  const out = new Uint8Array(16 + message.length);
  out.set(poly1305(stream.subarray(0, KEY_BYTES), ciphertext));
  out.set(ciphertext, 16);
  return out;
};

export const seal = (
  recipientPublicKey: Uint8Array,
  message: Uint8Array,
  ephemeralSecret: Uint8Array = crypto.getRandomValues(
    new Uint8Array(KEY_BYTES),
  ),
): Uint8Array => {
  if (recipientPublicKey.length !== KEY_BYTES)
    throw new RangeError("recipient public key must be 32 bytes");
  if (ephemeralSecret.length !== KEY_BYTES)
    throw new RangeError("ephemeral secret must be 32 bytes");
  const ephemeral = rawPublicKey(ephemeralSecret);
  const nonceInput = new Uint8Array(2 * KEY_BYTES);
  nonceInput.set(ephemeral);
  nonceInput.set(recipientPublicKey, KEY_BYTES);
  const nonce = blake2b(nonceInput, 24);
  const box = boxEasy(message, nonce, recipientPublicKey, ephemeralSecret);
  const out = new Uint8Array(KEY_BYTES + box.length);
  out.set(ephemeral);
  out.set(box, KEY_BYTES);
  return out;
};
