import { beforeAll, describe, expect, test } from "bun:test";
import sodium, { ready } from "libsodium-wrappers";
import { blake2b } from "../src/blake2b.ts";
import { seal } from "../src/sealed-box.ts";

const SIZES = [0, 1, 15, 16, 17, 63, 64, 65, 1000, 4096];
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

const libsodiumSeal = (
  recipient: Uint8Array,
  message: Uint8Array,
  ephemeralSecret: Uint8Array,
): Uint8Array => {
  const ephemeral = sodium.crypto_scalarmult_base(ephemeralSecret);
  const nonce = sodium.crypto_generichash(
    sodium.crypto_box_NONCEBYTES,
    new Uint8Array([...ephemeral, ...recipient]),
    null,
  );
  const box = sodium.crypto_box_easy(
    message,
    nonce,
    recipient,
    ephemeralSecret,
  );
  return new Uint8Array([...ephemeral, ...box]);
};

beforeAll(async () => {
  await ready;
});

describe("sealed box", () => {
  test("libsodium opens every sealed message, for several recipients and message sizes", () => {
    for (let k = 0; k < 4; k++) {
      const { publicKey, privateKey } = sodium.crypto_box_keypair();
      for (const size of SIZES) {
        const message = random(size);
        const sealed = seal(publicKey, message);
        expect(sealed.length).toBe(sodium.crypto_box_SEALBYTES + size);
        expect(
          sodium.crypto_box_seal_open(sealed, publicKey, privateKey),
        ).toEqual(message);
      }
    }
  });

  test("with a fixed ephemeral key the output is byte-identical to libsodium's", () => {
    for (const size of SIZES) {
      const { publicKey } = sodium.crypto_box_keypair();
      const ephemeralSecret = random(32);
      const message = random(size);
      expect(seal(publicKey, message, ephemeralSecret)).toEqual(
        libsodiumSeal(publicKey, message, ephemeralSecret),
      );
    }
  });

  test("a fresh ephemeral key is drawn on every call", () => {
    const { publicKey } = sodium.crypto_box_keypair();
    const message = random(32);
    expect(seal(publicKey, message)).not.toEqual(seal(publicKey, message));
  });

  test("libsodium refuses a ciphertext with any one byte flipped", () => {
    const { publicKey, privateKey } = sodium.crypto_box_keypair();
    const sealed = seal(publicKey, random(100));
    for (const index of [0, 31, 32, 47, 48, sealed.length - 1]) {
      const tampered = sealed.slice();
      tampered[index] = (tampered[index] ?? 0) ^ 0x01;
      expect(() =>
        sodium.crypto_box_seal_open(tampered, publicKey, privateKey),
      ).toThrow();
    }
  });

  test("BLAKE2b matches libsodium's generichash across lengths and block boundaries", () => {
    for (const size of [0, 1, 64, 127, 128, 129, 256, 1000])
      for (const out of [16, 24, 32, 64]) {
        const data = random(size);
        expect(blake2b(data, out)).toEqual(
          sodium.crypto_generichash(out, data, null),
        );
      }
  });

  test("a wrong-length key is refused without echoing key bytes", () => {
    const short = new Uint8Array(31).fill(0xab);
    expect(() => seal(short, random(4))).toThrow(
      "recipient public key must be 32 bytes",
    );
    const error = (() => {
      try {
        seal(sodium.crypto_box_keypair().publicKey, random(4), short);
        return "";
      } catch (e) {
        return String(e);
      }
    })();
    expect(error).toContain("ephemeral secret must be 32 bytes");
    expect(error).not.toMatch(/ab|171/);
  });
});
