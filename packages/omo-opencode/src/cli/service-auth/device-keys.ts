import { generateKeyPairSync } from "node:crypto"
import { SignInError } from "./protocol"

export function generateDeviceKeys() {
  const signing = generateKeyPairSync("ed25519")
  const sealing = generateKeyPairSync("x25519")
  const signingKey = signing.publicKey.export({ format: "jwk" }).x
  const sealingKey = sealing.publicKey.export({ format: "jwk" }).x
  if (!signingKey || !sealingKey) throw new SignInError("Unable to generate device keys.")
  return {
    public: { signingKey, sealingKey },
    private: {
      signingPrivateKey: signing.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
      sealingPrivateKey: sealing.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    },
  }
}
