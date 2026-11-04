import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, test } from "bun:test";
import { LocalApiError } from "../../src/local-api/errors.ts";
import { cleanup, connectClient, deviceKeys, startOwner } from "./support.ts";

afterEach(cleanup);

const DEVICE = { id: "dev-self", name: "This Mac" };
const pem = generateKeyPairSync("ed25519")
  .privateKey.export({ format: "pem", type: "pkcs8" })
  .toString();

describe("LA12 device.adopt with a malformed key is refused", () => {
  test("each malformed key is refused invalid_request, never adopted, and never echoed back", async () => {
    const owner = await startOwner();
    const client = await connectClient(owner);
    const good = deviceKeys();
    const cases: readonly (readonly [string, string, string])[] = [
      ["not base64", "%%%%", good.sealing],
      [
        "truncated to 47 bytes",
        Buffer.from(good.signing, "base64").subarray(0, 47).toString("base64"),
        good.sealing,
      ],
      ["a sealing key in the signing slot", good.sealing, good.sealing],
      ["a signing key in the sealing slot", good.signing, good.signing],
      ["PEM armor instead of the base64 body", pem, good.sealing],
      ["a trailing newline", `${good.signing}\n`, good.sealing],
      ["empty", "", good.sealing],
    ];
    for (const [name, signing, sealing] of cases) {
      const adopting = client.request("device.adopt", {
        device: DEVICE,
        signing_private_key: signing,
        sealing_private_key: sealing,
      });
      const error = await adopting.then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(error, name).toBeInstanceOf(LocalApiError);
      if (!(error instanceof LocalApiError)) continue;
      expect(error.code, name).toBe("invalid_request");
      if (signing.length > 8) expect(error.reason.includes(signing), name).toBe(false);
      expect(error.reason.includes(good.sealing), name).toBe(false);
    }
    expect(owner.state.adoptions).toBe(0);
  });

  test("control: well-formed PKCS#8 keys of the right algorithms are adopted", async () => {
    const owner = await startOwner();
    const client = await connectClient(owner);
    const keys = deviceKeys();
    const adopted = await client.request("device.adopt", {
      device: DEVICE,
      signing_private_key: keys.signing,
      sealing_private_key: keys.sealing,
    });
    expect(adopted).toEqual({ device: DEVICE });
    expect(owner.state.adoptions).toBe(1);
  });
});
