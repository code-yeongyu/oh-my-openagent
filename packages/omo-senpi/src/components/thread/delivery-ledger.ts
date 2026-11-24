/**
 * The sender device a delivery's ledger key names: `device:<device>/<id>` (amendment A4.3.1 of #13037). The engine's own
 * key for a live arrival URI-encodes the device part; the gateway store's key for a delivery taken in from another device
 * writes it as the device id, which encodes to itself. `rpc:local/<id>`, a bare row id or an empty device part name no
 * device. A device part that is not valid URI encoding is kept as written: it names no listed device, so whatever looks it
 * up misses.
 */
export function ledgerDevice(id: string): string | undefined {
  if (!id.startsWith(LEDGER_DEVICE)) return undefined
  const rest = id.slice(LEDGER_DEVICE.length)
  const slash = rest.indexOf("/")
  const part = slash === -1 ? rest : rest.slice(0, slash)
  if (part === "") return undefined
  try {
    return decodeURIComponent(part)
  } catch {
    return part
  }
}

const LEDGER_DEVICE = "device:"
