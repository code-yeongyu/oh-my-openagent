const REPLACEMENT_CHAR = "\uFFFD";
const TEXT_ENCODER = new TextEncoder();

export interface TruncationResult {
	result: string;
	truncated: boolean;
	originalBytes: number;
	resultBytes: number;
}

export function truncateBytes(content: string, maxBytes: number): TruncationResult {
	const bytes = TEXT_ENCODER.encode(content);
	if (bytes.byteLength <= maxBytes) {
		return {
			result: content,
			truncated: false,
			originalBytes: bytes.byteLength,
			resultBytes: bytes.byteLength,
		};
	}

	const decoder = new TextDecoder("utf-8", { fatal: false });
	let decoded = decoder.decode(bytes.subarray(0, maxBytes));
	while (decoded.endsWith(REPLACEMENT_CHAR)) {
		decoded = decoded.slice(0, -1);
	}

	const finalBytes = TEXT_ENCODER.encode(decoded).byteLength;
	return {
		result: decoded,
		truncated: true,
		originalBytes: bytes.byteLength,
		resultBytes: finalBytes,
	};
}
