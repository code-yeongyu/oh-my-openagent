// The runtime's own Ed25519 verifier, used only as a control: it shows which inputs the strict helper refuses
// although the runtime alone would accept them. Production code never verifies through it.
export const nativeEd25519Verify = async (
  key: Uint8Array<ArrayBuffer>,
  signature: Uint8Array<ArrayBuffer>,
  message: Uint8Array<ArrayBuffer>,
): Promise<boolean> => {
  const imported = await crypto.subtle.importKey("raw", key, { name: "Ed25519" }, false, ["verify"])
  return crypto.subtle.verify({ name: "Ed25519" }, imported, signature, message)
}
