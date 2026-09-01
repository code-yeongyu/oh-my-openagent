export class Text {
	constructor(
		public readonly text: string,
		public readonly x = 0,
		public readonly y = 0,
	) {}

	toString(): string {
		return this.text;
	}
}

export function truncateToWidth(value: string, width: number): string {
	if (width <= 0) return "";
	if (value.length <= width) return value;
	if (width <= 3) return value.slice(0, width);
	return `${value.slice(0, width - 3)}...`;
}

export function matchesKey(data: string, key: "escape" | "ctrl+c"): boolean {
	switch (key) {
		case "escape":
			return data === "\u001b";
		case "ctrl+c":
			return data === "\u0003";
	}
}
