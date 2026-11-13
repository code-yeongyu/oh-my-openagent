export function barrier() {
	let resolve: () => void = () => {
		throw new Error("barrier not initialized");
	};
	const promise = new Promise<void>((done, reject) => {
		const timeout = setTimeout(() => reject(new Error("barrier timed out")), 5_000);
		resolve = () => {
			clearTimeout(timeout);
			done();
		};
	});
	return { promise, resolve };
}
