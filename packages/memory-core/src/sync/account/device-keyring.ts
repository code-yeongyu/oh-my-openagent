import { deviceIdOf } from "../crypto/signatures.ts"
import { createDeviceKeyring, type DeviceKeyMaterial, type DeviceKeyring } from "../keyring-port.ts"

/**
 * The keyring of a signed-in device from the key pair it registered with the service: its sync
 * principal id is derived from the signing public key (sync-design section 8.1), never chosen.
 */
export async function deviceKeyringFromMaterial(material: DeviceKeyMaterial): Promise<DeviceKeyring> {
  const id = await deviceIdOf(createDeviceKeyring("", material).publicKeys().signing)
  if (id === null) throw new Error("invalid device key material")
  return createDeviceKeyring(id, material)
}
