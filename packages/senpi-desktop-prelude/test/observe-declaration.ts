/// <reference path="../declarations.d.ts" />

/** Compile proof of observe on direct and run-scoped window handles. */
async function observeDeclarationSurface(desktop: ComputerDesktop): Promise<void> {
	const win = await desktop.window("101");
	const observed: ComputerObserveResult = await win.observe({
		silent: true, all: true, maxDepth: 3, maxNodes: 12,
	});
	const frame: ComputerScreenshotResult = observed;
	const text: string = observed.ax;
	const nodes: number = observed.nodeCount;
	const truncated: boolean = observed.truncated;
	const direct: ComputerObserveResult = await (await computer.window(win.id)).observe();
	void [frame, text, nodes, truncated, direct];
}

void observeDeclarationSurface;
