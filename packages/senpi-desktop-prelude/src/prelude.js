// Eval-kernel `computer` global: sugar over the ordinary registered tool call `tool.computer(...)`.
// Each helper is one tool call, so lazy activation and the permission-system preflight apply to it; `verify` alone
// repeats read calls until its deadline. The method lists in the generated region come from facade-manifest.json.
{
	// Children a cell starts inherit the marker, so an SDK inside them refuses to spawn a second engine. It is written
	// only to an environment the kernel owns: a worker thread's own process.env view, or a process-mode kernel's own
	// process. On a host's main thread the write would reach every later child of the host (the bash tool, subagent
	// processes, the desktop service), so it is skipped there. The Python kernel is always its own process.
	const kernelProcess = globalThis.process;
	const ownsEnvironment = kernelProcess?.getBuiltinModule?.("node:worker_threads")?.isMainThread === false ||
		globalThis[Symbol.for("senpi.kernel.processMode")] === true;
	if (kernelProcess?.env && ownsEnvironment) kernelProcess.env.SENPI_DESKTOP_HOST = "1";
	const validateOptions = (label, options) => {
		if (options === undefined) return {};
		if (options === null || typeof options !== "object" || Array.isArray(options)) {
			throw new TypeError(`${label}() expects an options object`);
		}
		return options;
	};
	const serializeFunction = (label, fn) => {
		const source = String(fn);
		if (source.includes("[native code]")) {
			throw new TypeError(`${label} cannot serialize a native or bound function; pass an arrow or function expression`);
		}
		return source;
	};
	// Direct helpers cross the tool boundary as JSON, where functions and RegExp values would vanish silently.
	const plainArg = value => {
		if (typeof value === "function" || value instanceof RegExp) {
			throw new TypeError("computer helpers take plain data; pass functions and RegExp values through computer.run(fn, { args })");
		}
		return value;
	};
	const trimArgs = args => {
		const trimmed = [...args];
		while (trimmed.length > 0 && trimmed[trimmed.length - 1] === undefined) trimmed.pop();
		return trimmed;
	};
	// `computer.run(fn)` ships source text, so each argument becomes a JavaScript expression.
	const runArgSource = value => {
		if (typeof value === "function") return `(${serializeFunction("computer.run() argument", value)})`;
		if (value instanceof RegExp) return String(value);
		return JSON.stringify(value) ?? "undefined";
	};
	// The tool result is `{ text, details?, images?, hasError? }`: images display, `details.value` is the return value.
	// A failed call's `details.value.code` (COMPUTER_*) rides on the thrown error as `error.code`.
	const invoke = async args => {
		const result = await globalThis.tool.computer(args);
		if (result.hasError) {
			const error = new Error(result.text);
			const code = result.details?.value?.code;
			if (typeof code === "string") error.code = code;
			throw error;
		}
		for (const image of result.images ?? []) globalThis.display(image);
		return result.details?.value;
	};
	const callValue = chain => invoke({ action: "call", chain });
	const step = (method, args) => ({ method, args: trimArgs(args).map(plainArg) });
	// Methods stay non-enumerable so handles display and serialize as their identity fields only.
	const defineMethod = (target, name, fn) => Object.defineProperty(target, name, { value: fn });
	const defineValueMethods = (target, methods, chain) => {
		for (const method of methods) {
			defineMethod(target, method, (...args) => callValue(chain(step(method, args))));
		}
	};

	// <generated:facade> from facade-manifest.json by scripts/generate-assets.ts; edit CHAIN_BINDINGS there, then `bun run generate`
	const desktopValueMethods = ["displays", "windows", "screenshot", "zoom", "click", "doubleClick", "move", "drag", "scroll", "type", "press", "holdKeys", "holdMouse"];
	const displayValueMethods = ["screenshot", "zoom", "click", "doubleClick", "move", "drag", "scroll", "type", "press", "holdKeys", "holdMouse"];
	const windowValueMethods = ["screenshot", "observe", "zoom", "click", "doubleClick", "move", "drag", "scroll", "type", "press", "holdKeys", "holdMouse", "raise", "ax"];
	const elementValueMethods = ["value", "setValue", "bounds", "attributes", "actions", "perform", "press", "click", "type", "focus"];
	// </generated:facade>
	const windowFields = ["id", "app", "title", "pid", "bounds", "focused"];
	const elementFields = ["ref", "role", "nativeRole", "title", "description", "enabled", "focused", "childCount"];

	const copyFields = (target, fields, snapshot) => {
		for (const field of fields) {
			if (snapshot[field] !== undefined) Object.defineProperty(target, field, { value: snapshot[field], enumerable: true });
		}
	};
	const makeElement = snapshot => {
		const element = {};
		copyFields(element, elementFields, snapshot);
		defineMethod(element, "toString", () => `<element ${snapshot.ref} ${snapshot.role}>`);
		const via = next => [step("ref", [snapshot.ref]), next];
		defineValueMethods(element, elementValueMethods, via);
		defineMethod(element, "parent", async () => {
			const parent = await callValue(via(step("parent", [])));
			return parent ? makeElement(parent) : null;
		});
		defineMethod(element, "children", async () => (await callValue(via(step("children", [])))).map(makeElement));
		return Object.freeze(element);
	};
	const resolveElement = async chain => {
		const snapshot = await callValue(chain);
		return snapshot ? makeElement(snapshot) : null;
	};
	const makeWindow = snapshot => {
		const win = {};
		copyFields(win, windowFields, snapshot);
		defineMethod(win, "toString", () => `<window ${snapshot.id} ${snapshot.app}>`);
		const via = next => [step("window", [snapshot.id]), next];
		defineValueMethods(win, windowValueMethods, via);
		defineMethod(win, "find", async query => (await callValue(via(step("find", [query])))).map(makeElement));
		defineMethod(win, "ref", ref => resolveElement([step("ref", [ref])]));
		// The tree under one element of this window (`ax.snapshot` with a root); the parent snapshot's refs stay valid.
		defineMethod(win, "drill", (ref, options) =>
			callValue(via(step("ax", [{ ...validateOptions("win.drill", options), root: ref }]))),
		);
		defineMethod(win, "menu", Object.freeze({
			items: path => callValue(via(step("menu.items", [path]))),
			select: (path, options) => callValue(via(step("menu.select", options === undefined ? [path] : [path, options]))),
		}));
		return Object.freeze(win);
	};
	const resolveWindow = async chain => {
		const snapshot = await callValue(chain);
		return snapshot ? makeWindow(snapshot) : null;
	};

	const computer = {};
	defineValueMethods(computer, desktopValueMethods, next => [next]);
	computer.window = selector => resolveWindow([step("window", [selector])]);
	computer.display = async selector => {
		const snapshot = await callValue([step("display", [selector])]);
		const target = {};
		copyFields(target, ["id"], snapshot);
		defineValueMethods(target, displayValueMethods, next => [step("display", [snapshot.id]), next]);
		return Object.freeze(target);
	};
	computer.focusedWindow = () => resolveWindow([step("focusedWindow", [])]);
	computer.elementAt = (x, y) => resolveElement([step("elementAt", [x, y])]);
	computer.focusedElement = () => resolveElement([step("focusedElement", [])]);
	computer.ref = ref => resolveElement([step("ref", [ref])]);
	computer.clipboard = Object.freeze({
		read: () => callValue([step("clipboard.read", [])]),
		write: text => callValue([step("clipboard.write", [text])]),
	});
	computer.control = Object.freeze({
		acquire: options => callValue([step("control.acquire", [options])]),
		release: () => callValue([step("control.release", [])]),
		state: () => callValue([step("control.state", [])]),
	});
	computer.run = async (fnOrCode, options) => {
		if (typeof fnOrCode !== "function" && typeof fnOrCode !== "string") {
			throw new TypeError("computer.run() expects a function or code string");
		}
		const opts = validateOptions("computer.run", options);
		let code = fnOrCode;
		if (typeof fnOrCode === "function") {
			const args = trimArgs(Array.isArray(opts.args) ? opts.args : []).map(value => `, ${runArgSource(value)}`);
			code = `return await (${serializeFunction("computer.run()", fnOrCode)})({ desktop, wait, assert }${args.join("")});`;
		}
		const parameters = { action: "run", code };
		if (opts.read_only !== undefined) parameters.read_only = opts.read_only;
		if (opts.timeout !== undefined) parameters.timeout = opts.timeout;
		return invoke(parameters);
	};
	const EXPECTATION_KINDS = new Set(["elementExists", "elementValue", "elementEnabled", "elementSelected", "windowExists", "windowGone", "windowBounds"]);
	const TRUE_ATTRIBUTE = new Set(["1", "true", "yes"]);
	const includesText = (value, part) =>
		part === undefined || String(value).toLocaleLowerCase().includes(String(part).toLocaleLowerCase());
	const matchesWindow = (win, selector) =>
		typeof selector === "string"
			? win.id === selector
			: (selector.id === undefined || win.id === selector.id) && includesText(win.app, selector.app) && includesText(win.title, selector.title);
	const windowsMatching = async selector => (await callValue([step("windows", [])])).filter(win => matchesWindow(win, selector));
	const readElement = (ref, method) => callValue(method === undefined ? [step("ref", [ref])] : [step("ref", [ref]), step(method, [])]);
	// One read of the state an expectation names; throws when the read fails.
	const holds = async expectation => {
		switch (expectation.kind) {
			case "elementExists":
				try {
					await readElement(expectation.ref);
					return expectation.exists ?? true;
				} catch (error) {
					// A ref that no longer resolves answers the question (the element is gone); other failures do not.
					if (error?.code === "COMPUTER_STALE_REF") return !(expectation.exists ?? true);
					throw error;
				}
			case "elementValue":
				return (await readElement(expectation.ref, "value")) === expectation.value;
			case "elementEnabled":
				return (await readElement(expectation.ref)).enabled === (expectation.enabled ?? true);
			case "elementSelected": {
				const attributes = await readElement(expectation.ref, "attributes");
				return TRUE_ATTRIBUTE.has(String(attributes?.AXSelected ?? "").toLowerCase()) === (expectation.selected ?? true);
			}
			case "windowExists":
				return (await windowsMatching(expectation.window)).length > 0;
			case "windowGone":
				return (await windowsMatching(expectation.window)).length === 0;
			case "windowBounds": {
				const found = await windowsMatching(expectation.window);
				if (found.length > 1) throw new Error(`InvalidTarget: verify windowBounds matches ${found.length} windows`);
				const box = found[0]?.bounds ?? found[0];
				const tolerance = expectation.tolerance ?? 0;
				return box !== undefined && ["x", "y", "width", "height"].every(field =>
					expectation.bounds[field] === undefined || Math.abs(box[field] - expectation.bounds[field]) <= tolerance);
			}
		}
	};
	// Deadline-bounded poll of read calls: never sends input and never waits past the deadline.
	computer.verify = async (expectation, options) => {
		if (expectation === null || typeof expectation !== "object" || !EXPECTATION_KINDS.has(expectation.kind)) {
			throw new TypeError(`computer.verify() expects an expectation whose kind is one of ${[...EXPECTATION_KINDS].join(", ")}`);
		}
		const opts = validateOptions("computer.verify", options);
		const timeoutMs = opts.timeoutMs ?? 2000;
		if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs < 0) {
			throw new TypeError("computer.verify() timeoutMs must be a finite, non-negative number");
		}
		const intervalMs = opts.intervalMs ?? 100;
		if (typeof intervalMs !== "number" || !Number.isFinite(intervalMs) || intervalMs < 0) {
			throw new TypeError("computer.verify() intervalMs must be a finite, non-negative number");
		}
		const interval = Math.max(intervalMs, 10);
		const started = Date.now();
		const deadline = started + timeoutMs;
		let reads = 0;
		for (;;) {
			let satisfied;
			try {
				reads += 1;
				satisfied = await holds(expectation);
			} catch (error) {
				return { status: "unknown", reads, elapsedMs: Date.now() - started, cause: String(error?.message ?? error) };
			}
			const now = Date.now();
			if (satisfied) return { status: "satisfied", reads, elapsedMs: now - started };
			if (now >= deadline) return { status: "unsatisfied", reads, elapsedMs: now - started };
			await new Promise(resolve => setTimeout(resolve, Math.min(interval, deadline - now)));
		}
	};
	computer.capabilities = () => invoke({ action: "capabilities" });
	computer.close = async () => {
		await invoke({ action: "close" });
	};
	globalThis.computer = Object.freeze(computer);
}
