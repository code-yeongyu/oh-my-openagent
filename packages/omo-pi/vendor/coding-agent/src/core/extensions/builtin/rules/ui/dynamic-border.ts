import type { Component } from "@earendil-works/pi-tui";

export class DynamicBorder implements Component {
	private readonly color: (str: string) => string;

	constructor(color: (str: string) => string) {
		this.color = color;
	}

	render(width: number): string[] {
		return [this.color("─".repeat(Math.max(1, width)))];
	}

	invalidate(): void {}
}
