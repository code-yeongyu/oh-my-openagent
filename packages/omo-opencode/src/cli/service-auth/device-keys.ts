import { createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto"
import { SignInError } from "./protocol"

const publicKeyOf = (privateKey: string): string | undefined => {
  try {
    return createPublicKey(
      createPrivateKey({ key: Buffer.from(privateKey, "base64"), format: "der", type: "pkcs8" }),
    ).export({ format: "jwk" }).x
  } catch {
    return undefined
  }
}

/** The public keys of stored private keys, in the service's encoding; undefined when either key does not parse. */
export function publicKeysOf(credentials: { readonly signingPrivateKey: string; readonly sealingPrivateKey: string }) {
  const signingKey = publicKeyOf(credentials.signingPrivateKey)
  const sealingKey = publicKeyOf(credentials.sealingPrivateKey)
  return signingKey === undefined || sealingKey === undefined ? undefined : { signingKey, sealingKey }
}

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
