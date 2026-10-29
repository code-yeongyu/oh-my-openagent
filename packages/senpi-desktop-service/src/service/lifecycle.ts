/** Order lifecycle transitions while preserving each caller's individual outcome. */
export class Lifecycle {
	#tail: Promise<unknown> = Promise.resolve();

	run<T>(work: () => Promise<T>): Promise<T> {
		const run = this.#tail.then(work);
		this.#tail = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	}
}
