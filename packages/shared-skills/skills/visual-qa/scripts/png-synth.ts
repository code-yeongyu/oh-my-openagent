import { Buffer } from "node:buffer"
import { deflateSync } from "node:zlib"

import { crc32, PNG_SIGNATURE } from "./png-crc"

const BIT_DEPTH_8 = 8
const COLOR_TYPE_RGBA = 6
const FILTER_NONE = 0
const RGBA_CHANNELS = 4

function pngChunk(type: string, data: Buffer): Buffer {
	const typeBuffer = Buffer.from(type, "ascii")
	const length = Buffer.alloc(4)
	length.writeUInt32BE(data.length, 0)
	const crcBuffer = Buffer.alloc(4)
	crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)
	return Buffer.concat([length, typeBuffer, data, crcBuffer])
}

export function encodeRgbaPng(width: number, height: number, rgba: Uint8Array): Buffer {
	const rowBytes = width * RGBA_CHANNELS
	const raw = Buffer.alloc(height * (rowBytes + 1))
	for (let y = 0; y < height; y++) {
		const rowStart = y * (rowBytes + 1)
		raw[rowStart] = FILTER_NONE
		for (let x = 0; x < rowBytes; x++) {
			raw[rowStart + 1 + x] = rgba[y * rowBytes + x] ?? 0
		}
	}
	const header = Buffer.alloc(13)
	header.writeUInt32BE(width, 0)
	header.writeUInt32BE(height, 4)
	header[8] = BIT_DEPTH_8
	header[9] = COLOR_TYPE_RGBA
	return Buffer.concat([
		PNG_SIGNATURE,
		pngChunk("IHDR", header),
		pngChunk("IDAT", deflateSync(raw)),
		pngChunk("IEND", Buffer.alloc(0)),
	])
}

export function solidRgba(
	width: number,
	height: number,
	color: readonly [number, number, number, number],
): Uint8Array {
	const rgba = new Uint8Array(width * height * RGBA_CHANNELS)
	for (let pixel = 0; pixel < width * height; pixel++) {
		const offset = pixel * RGBA_CHANNELS
		rgba[offset] = color[0]
		rgba[offset + 1] = color[1]
		rgba[offset + 2] = color[2]
		rgba[offset + 3] = color[3]
	}
	return rgba
}
