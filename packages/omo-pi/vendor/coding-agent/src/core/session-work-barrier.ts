export class SessionWorkBarrier {
	private activeWork: Promise<void> | undefined = undefined;
	private activeWorkResolve: (() => void) | undefined = undefined;
	private activeWorkDepth = 0;

	get hasActiveWork(): boolean {
		return this.activeWork !== undefined;
	}

	begin(): () => void {
		if (!this.activeWork) {
			let resolveWork: (() => void) | undefined;
			this.activeWork = new Promise<void>((resolve) => {
				resolveWork = resolve;
			});
			if (!resolveWork) {
				throw new Error("Session work resolver was not initialized");
			}
			this.activeWorkResolve = resolveWork;
		}

		this.activeWorkDepth++;
		let finished = false;
		return () => {
			if (finished) {
				return;
			}
			finished = true;
			this.activeWorkDepth = Math.max(0, this.activeWorkDepth - 1);
			if (this.activeWorkDepth > 0) {
				return;
			}

			const resolveWork = this.activeWorkResolve;
			this.activeWork = undefined;
			this.activeWorkResolve = undefined;
			resolveWork?.();
		};
	}

	async waitForSettled(getEventQueue: () => Promise<void>): Promise<void> {
		while (true) {
			const eventQueue = getEventQueue();
			const work = this.activeWork;

			await eventQueue;
			if (work) {
				await work;
			}

			if (getEventQueue() === eventQueue && !this.activeWork) {
				return;
			}
		}
	}
}
