// Eval-kernel `computer` global: sugar over the ordinary registered tool call `tool.computer(...)`.
// Each helper is one tool call, so lazy activation and the permission-system preflight apply to it.
{
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
	const invoke = async args => {
		const result = await globalThis.tool.computer(args);
		if (result.hasError) throw new Error(result.text);
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

	const windowFields = ["id", "app", "title", "pid", "bounds", "focused"];
	const windowValueMethods = ["screenshot", "click", "doubleClick", "move", "drag", "scroll", "type", "press", "raise", "ax"];
	const elementFields = ["ref", "role", "nativeRole", "title", "description", "enabled", "focused", "childCount"];
	const elementValueMethods = ["value", "setValue", "bounds", "attributes", "actions", "perform", "press", "click", "focus"];
	const desktopValueMethods = ["displays", "windows", "screenshot", "click", "doubleClick", "move", "drag", "scroll", "type", "press"];

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
		return Object.freeze(win);
	};
	const resolveWindow = async chain => {
		const snapshot = await callValue(chain);
		return snapshot ? makeWindow(snapshot) : null;
	};

	const computer = {};
	defineValueMethods(computer, desktopValueMethods, next => [next]);
	computer.window = selector => resolveWindow([step("window", [selector])]);
	computer.focusedWindow = () => resolveWindow([step("focusedWindow", [])]);
	computer.elementAt = (x, y) => resolveElement([step("elementAt", [x, y])]);
	computer.focusedElement = () => resolveElement([step("focusedElement", [])]);
	computer.ref = ref => resolveElement([step("ref", [ref])]);
	computer.clipboard = Object.freeze({
		read: () => callValue([step("clipboard.read", [])]),
		write: text => callValue([step("clipboard.write", [text])]),
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
	computer.capabilities = () => invoke({ action: "capabilities" });
	computer.close = async () => {
		await invoke({ action: "close" });
	};
	globalThis.computer = Object.freeze(computer);
}
