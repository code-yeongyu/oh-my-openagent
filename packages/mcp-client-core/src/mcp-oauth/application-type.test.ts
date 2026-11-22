import { describe, expect, it } from "bun:test"
import { getOrRegisterClient } from "./dcr"
import type { DcrFetch } from "./dcr"

describe("DCR application type interoperability", () => {
  for (const [redirectUri, applicationType] of [
    ["http://127.0.0.1:19877/callback", "native"],
    ["http://localhost:19877/callback", "native"],
    ["http://[::1]:19877/callback", "native"],
    ["myapp:/callback", "native"],
    ["https://app.example.com/callback", "web"],
  ]) {
    it(`registers ${redirectUri} as ${applicationType}`, async () => {
      // given: an OIDC DCR server enforcing the redirect/application pairing.
      const registrationServer: DcrFetch = async (_url, init) => {
        const request = JSON.parse(init?.body ?? "{}")
        return {
          ok: request.application_type === applicationType,
          json: async () => ({ client_id: "accepted-client" }),
        }
      }

      // when
      const client = await getOrRegisterClient({
        registrationEndpoint: "https://issuer.example.com/register",
        clientName: "CLI",
        redirectUris: [redirectUri ?? ""],
        tokenEndpointAuthMethod: "none",
        storage: { getClientRegistration: () => null, setClientRegistration: () => {} },
        fetch: registrationServer,
      })

      // then
      expect(client?.clientId).toBe("accepted-client")
    })
  }
})
