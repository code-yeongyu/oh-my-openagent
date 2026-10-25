/// <reference path="../declarations.d.ts" />

/** Compile proof of the public display handle API in both direct and run-scoped calls. */
async function displayDeclarationSurface(desktop: ComputerDesktop): Promise<void> {
	const handle: ComputerDisplayTarget = await desktop.display("all");
	const id: string = handle.id;
	const shot: ComputerScreenshotResult = await handle.screenshot();
	await handle.click(20, 10);
	await handle.doubleClick(20, 10);
	await handle.move(20, 10);
	await handle.drag([[0, 0], [20, 10]]);
	await handle.scroll(20, 10, { dy: 40 });
	await handle.type(id);
	await handle.press("cmd+a");
	await computer.display(shot.target);
}

void displayDeclarationSurface;
