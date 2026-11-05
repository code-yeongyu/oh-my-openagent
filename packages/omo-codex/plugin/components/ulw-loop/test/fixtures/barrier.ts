import { remainingTestTime } from "../../../../../../../test-support/test-deadline";

export function barrier() {
	let resolve: () => void = () => {
		throw new Error("barrier not initialized");
	};
	const promise = new Promise<void>((done, reject) => {
		const timeout = setTimeout(() => reject(new Error("barrier waited out the test budget")), remainingTestTime());
		resolve = () => {
			clearTimeout(timeout);
			done();
		};
	});
	return { promise, resolve };
}
