export function encodeJsonLine(message: unknown): string {
	return `${JSON.stringify(message)}\n`;
}

export interface LineDecoder {
	push(chunk: Buffer | string): void;
}

export function createLineDecoder(
	onMessage: (value: unknown) => void,
	onParseError?: (raw: string, error: unknown) => void,
): LineDecoder {
	let buffer = "";
	return {
		push(chunk: Buffer | string): void {
			buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
			let index = buffer.indexOf("\n");
			while (index !== -1) {
				const raw = buffer.slice(0, index).trim();
				buffer = buffer.slice(index + 1);
				if (raw.length > 0) {
					try {
						onMessage(JSON.parse(raw));
					} catch (error) {
						onParseError?.(raw, error);
					}
				}
				index = buffer.indexOf("\n");
			}
		},
	};
}
