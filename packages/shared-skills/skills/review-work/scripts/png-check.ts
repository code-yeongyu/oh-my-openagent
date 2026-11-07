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

export interface PngCheck {
	readonly ok: boolean
	readonly errors: readonly string[]
	readonly width: number
	readonly height: number
}

export function checkPng(buffer: Buffer): PngCheck {
	const errors: string[] = []
	let width = 0
	let height = 0
	if (buffer.length < PNG_SIGNATURE.length || !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
		return { ok: false, errors: ["missing PNG signature"], width, height }
	}
	let offset = PNG_SIGNATURE.length
	let sawIhdr = false
	let sawIend = false
	while (offset + 8 <= buffer.length) {
		const length = buffer.readUInt32BE(offset)
		const type = buffer.toString("ascii", offset + 4, offset + 8)
		const dataStart = offset + 8
		const dataEnd = dataStart + length
		if (dataEnd + 4 > buffer.length) {
			errors.push(`chunk ${type} is truncated`)
			break
		}
		const expectedCrc = buffer.readUInt32BE(dataEnd)
		const actualCrc = crc32(buffer.subarray(offset + 4, dataEnd))
		if (expectedCrc !== actualCrc) errors.push(`chunk ${type} has a bad CRC`)
		if (type === "IHDR") {
			sawIhdr = true
			if (length !== 13) errors.push("IHDR length is not 13")
			else {
				width = buffer.readUInt32BE(dataStart)
				height = buffer.readUInt32BE(dataStart + 4)
				if (width === 0 || height === 0) errors.push(`IHDR dimensions are ${width}x${height}`)
			}
		}
		if (type === "IEND") {
			sawIend = true
			break
		}
		offset = dataEnd + 4
	}
	if (!sawIhdr) errors.push("missing IHDR chunk")
	if (!sawIend) errors.push("missing IEND chunk")
	return { ok: errors.length === 0, errors, width, height }
}
