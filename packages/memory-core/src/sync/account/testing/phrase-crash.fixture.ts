import { deviceKeyring } from "../../genesis/vector.test-support.ts"
import { enableSync } from "../enable.ts"
import { createAccountHttp } from "../http.ts"
import { createPairingHttp } from "../pairing-http.ts"
import { ACCOUNT } from "./genesis-enable.test-support.ts"
import { openGate, phraseGenesis } from "./phrase-enable.test-support.ts"

const baseUrl = process.env["PHRASE_CRASH_URL"] ?? ""
const token = process.env["PHRASE_CRASH_TOKEN"] ?? ""
const pinDir = process.env["PHRASE_CRASH_PIN_DIR"] ?? ""
const http = { baseUrl, token: () => token }

await enableSync({
  account: ACCOUNT,
  serviceDeviceId: "service-first",
  serviceOrigin: baseUrl,
  keyring: await deviceKeyring(),
  pinDir,
  chain: createAccountHttp(http),
  pairing: createPairingHttp(http),
  method: "phrase",
  phraseGate: openGate(),
  genesis: {
    prfSupported: false,
    phraseSupported: true,
    createGenesis: async () => ({ ok: false, reason: "unavailable" }),
    createPhraseGenesis: phraseGenesis({
      show: async () => {
        process.stdout.write("SHOWN\n")
        return new Promise<boolean>(() => undefined)
      },
      confirm: async () => null,
    }),
  },
})
