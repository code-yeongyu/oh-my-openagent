export function leaseClock(initial = 0) {
	let now = initial;
	const tasks = new Set<{ at: number; fn: () => void }>();
	return {
		now: () => now,
		schedule(fn: () => void, ms: number) {
			const task = { at: now + ms, fn };
			tasks.add(task);
			return { unref() {}, cancel: () => tasks.delete(task) };
		},
		advance(ms: number) {
			const end = now + ms;
			for (;;) {
				const next = [...tasks].filter((task) => task.at <= end).sort((a, b) => a.at - b.at)[0];
				if (next === undefined) break;
				now = next.at;
				tasks.delete(next);
				next.fn();
			}
			now = end;
		},
	};
}
