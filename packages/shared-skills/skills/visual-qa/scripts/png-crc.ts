import { Buffer } from "node:buffer"

export const PNG_SIGNATURE: Buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function buildCrcTable(): Uint32Array {
	const table = new Uint32Array(256)
	for (let n = 0; n < 256; n++) {
		let c = n
		for (let k = 0; k < 8; k++) {
			c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
		}
		table[n] = c >>> 0
	}
	return table
}

const CRC_TABLE = buildCrcTable()

export function crc32(data: Buffer): number {
	let crc = 0xffffffff
	for (let i = 0; i < data.length; i++) {
		const byte = data[i] ?? 0
		const entry = CRC_TABLE[(crc ^ byte) & 0xff] ?? 0
		crc = entry ^ (crc >>> 8)
	}
	return (crc ^ 0xffffffff) >>> 0
}
