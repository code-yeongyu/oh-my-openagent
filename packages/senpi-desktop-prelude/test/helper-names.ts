import { loadJsFacade, runPythonFacade, windowResponder } from "./harness";

/** Every JavaScript facade helper: desktop root, clipboard, control, window handle, element handle. */
export async function javascriptHelperNames(): Promise<string[]> {
	const kernel = loadJsFacade(windowResponder);
	const names = await kernel.run(`
		const own = (target, prefix = "") =>
			Object.getOwnPropertyNames(target)
				.filter((name) => typeof target[name] === "function" && name !== "toString")
				.map((name) => prefix + name);
		const win = await computer.window("w1");
		const el = await computer.ref("e1");
		return [...own(computer), ...own(computer.clipboard, "clipboard."), ...own(computer.control, "control."), ...own(win), ...own(el)];
	`);
	return Array.isArray(names) ? names.map(String) : [];
}

/** Every public Python facade helper, with `raise_` mapped back to the method it sends. */
export function pythonHelperNames(): string[] {
	const run = runPythonFacade(`
def own(target, prefix=''):
    names = [n for n in dir(target) if not n.startswith('_') and callable(getattr(target, n))]
    return [prefix + ('raise' if n == 'raise_' else n) for n in names]
win = computer.window('w1')
out = own(computer) + own(computer.clipboard, 'clipboard.') + own(computer.control, 'control.') + own(win) + own(win.ref('e1'))
`);
	return Array.isArray(run.out) ? run.out.map(String) : [];
}
