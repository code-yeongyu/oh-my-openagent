export function hexToBytes(h: string): Uint8Array {
  if (h.length % 2 !== 0) throw new Error(`hex string must have even length, got ${h.length}`)
  const out = new Uint8Array(h.length / 2)
  for (let i = 0; i < out.length; i++) {
    const slice = h.slice(i * 2, i * 2 + 2)
    const byte = parseInt(slice, 16)
    if (Number.isNaN(byte)) throw new Error(`invalid hex character in: ${slice}`)
    out[i] = byte
  }
  return out
}

export function bytesToHex(b: Uint8Array): string {
  let s = ""
  for (let i = 0; i < b.length; i++) s += b[i]!.toString(16).padStart(2, "0")
  return s
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
