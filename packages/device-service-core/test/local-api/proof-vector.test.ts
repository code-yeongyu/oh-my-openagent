import { describe, expect, test } from "bun:test";
import {
  clientProof,
  proofMatches,
  serverProof,
  tcpEndpoint,
  UNIX_ENDPOINT,
} from "../../src/local-api/access.ts";

const token = new Uint8Array(32).fill(0x11);
const nonce = Buffer.alloc(32, 0x22).toString("base64url");

describe("the documented proof vector", () => {
  test("server_proof and client_proof over 32 x 0x11, a nonce of 32 x 0x22 and each endpoint match docs/local-api.md", () => {
    expect(nonce).toBe("IiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiI");
    expect(UNIX_ENDPOINT).toBe("unix");
    expect(tcpEndpoint(49152)).toBe("tcp:49152");
    expect(serverProof(token, nonce, UNIX_ENDPOINT)).toBe(
      "TLdIwpwhlMugnecRwFIoNTrwIxH9HjwJ98_hpMaqKIQ",
    );
    expect(clientProof(token, nonce, UNIX_ENDPOINT)).toBe(
      "sfkHyU_lyf5fLfS9ag1RJI50KPgq4iqBCOXFWn8e0N8",
    );
    expect(serverProof(token, nonce, tcpEndpoint(49152))).toBe(
      "4BSzSrSHpBmfLPEkF5-xi39PnUfJO5W3RZKOZNDa0fc",
    );
    expect(clientProof(token, nonce, tcpEndpoint(49152))).toBe(
      "ODo5pWCMHx-GmOQOtLWFbYYNCUqJp-ZChkEqTbVjcAo",
    );
  });

  test("the two labels give different proofs, and a proof matches only itself", () => {
    const server = serverProof(token, nonce, UNIX_ENDPOINT);
    expect(proofMatches(server, clientProof(token, nonce, UNIX_ENDPOINT))).toBe(false);
    expect(proofMatches(server, server)).toBe(true);
    expect(proofMatches(server, `${server}x`)).toBe(false);
  });

  test("a proof computed for port A is refused on port B", () => {
    const a = tcpEndpoint(49152);
    const b = tcpEndpoint(49153);
    expect(proofMatches(serverProof(token, nonce, b), serverProof(token, nonce, a))).toBe(false);
    expect(proofMatches(clientProof(token, nonce, b), clientProof(token, nonce, a))).toBe(false);
    expect(
      proofMatches(clientProof(token, nonce, b), clientProof(token, nonce, UNIX_ENDPOINT)),
    ).toBe(false);
  });
});
