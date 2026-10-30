// raw-decode.mjs - decode a source's raw bytes in their declared encoding and keep a byte map.
//
// decodeRaw returns { text, encoding, bytes } where bytes[i] is the raw byte offset at which UTF-16
// unit i of `text` starts and bytes[text.length] === raw.length, so any text range maps back to the
// bytes the source actually holds (never to a lossy UTF-8 re-encode). The encoding comes from a
// BOM, then the caller's declared charset (HTTP header or meta.json), then an HTML <meta> charset,
// and defaults to UTF-8. node: builtins only (TextDecoder).

const SNIFF_BYTES = 1024
const META_CHARSET = /<meta\b[^>]*?charset\s*=\s*["']?\s*([\w.:-]+)/i

/** The WHATWG encoding name for a label, or null when the runtime does not know it. */
export function encodingOf(label) {
	if (typeof label !== "string" || label.trim() === "") return null
	try {
		return new TextDecoder(label.trim()).encoding
	} catch {
		return null
	}
}

/** charset=... from a Content-Type header value, as an encoding name, or null. */
export function headerCharset(contentType) {
	const match = /charset\s*=\s*["']?([\w.:-]+)/i.exec(String(contentType ?? ""))
	return match ? encodingOf(match[1]) : null
}

function bomOf(raw) {
	if (raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) return { encoding: "utf-8", skip: 3 }
	if (raw[0] === 0xff && raw[1] === 0xfe) return { encoding: "utf-16le", skip: 2 }
	if (raw[0] === 0xfe && raw[1] === 0xff) return { encoding: "utf-16be", skip: 2 }
	return null
}

/** BOM, then the declared charset, then (for markup) a <meta> charset in the first 1 KiB, then UTF-8. */
export function detectEncoding(raw, declared = null, markup = false) {
	const bom = bomOf(raw)
	if (bom) return bom.encoding
	const given = encodingOf(declared)
	if (given) return given
	if (markup) {
		const sniffed = META_CHARSET.exec(Buffer.from(raw.subarray(0, SNIFF_BYTES)).toString("latin1"))
		const named = sniffed ? encodingOf(sniffed[1]) : null
		// A page that is already decoded to UTF-16 cannot declare a UTF-16 charset in ASCII bytes.
		if (named && !named.startsWith("utf-16")) return named
	}
	return "utf-8"
}

function utf8Map(text, bytes, from) {
	let at = from
	for (let i = 0; i < text.length; i++) {
		bytes[i] = at
		const code = text.charCodeAt(i)
		if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
			bytes[++i] = at
			at += 4
		} else at += code < 0x80 ? 1 : code < 0x800 ? 2 : 3
	}
	return at
}

/** Byte-at-a-time streaming decode: correct for any encoding, used when no shortcut applies. */
function streamMap(raw, encoding, from) {
	const decoder = new TextDecoder(encoding)
	const units = []
	const starts = []
	let pending = from
	for (let i = from; i < raw.length; i++) {
		const out = decoder.decode(raw.subarray(i, i + 1), { stream: true })
		if (out.length === 0) continue
		// A replacement for an earlier broken sequence can arrive with this byte's own character.
		const own = out.length > 1 && raw[i] < 0x80 ? 1 : 0
		for (let k = 0; k < out.length; k++) starts.push(k >= out.length - own ? i : pending)
		units.push(out)
		pending = i + 1
	}
	const tail = decoder.decode()
	for (let k = 0; k < tail.length; k++) starts.push(pending)
	units.push(tail)
	return { text: units.join(""), starts }
}

/** Decode raw bytes; bytes is an Int32Array of length text.length + 1 (see the file comment). */
export function decodeRaw(raw, declared = null, markup = false) {
	const buffer = Buffer.from(raw)
	const encoding = detectEncoding(buffer, declared, markup)
	const skip = bomOf(buffer)?.encoding === encoding ? bomOf(buffer).skip : 0
	if (encoding === "utf-8") {
		try {
			const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer.subarray(skip))
			const bytes = new Int32Array(text.length + 1)
			bytes[text.length] = utf8Map(text, bytes, skip)
			return { text, encoding, bytes }
		} catch {
			// invalid UTF-8: fall through to the streaming map, which counts each broken byte once
		}
	}
	if (encoding !== "utf-8" && !encoding.startsWith("utf-16")) {
		const text = new TextDecoder(encoding).decode(buffer.subarray(skip))
		if (text.length === buffer.length - skip) {
			const bytes = new Int32Array(text.length + 1)
			for (let i = 0; i <= text.length; i++) bytes[i] = skip + i
			return { text, encoding, bytes }
		}
	}
	const { text, starts } = streamMap(buffer, encoding, skip)
	const bytes = Int32Array.from([...starts, buffer.length])
	return { text, encoding, bytes }
}
