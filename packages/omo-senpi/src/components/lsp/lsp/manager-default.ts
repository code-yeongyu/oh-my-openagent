import { LspManager } from "./manager.js";

let defaultInstance: LspManager | null = null;

export function getLspManager(): LspManager {
	if (!defaultInstance) {
		defaultInstance = new LspManager();
	}
	return defaultInstance;
}

export async function disposeDefaultLspManager(): Promise<void> {
	if (defaultInstance) {
		const manager = defaultInstance;
		defaultInstance = null;
		await manager.stopAll();
	}
}
