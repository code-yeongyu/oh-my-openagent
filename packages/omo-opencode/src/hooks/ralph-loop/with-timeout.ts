export async function withTimeout<TData>(
	promise: Promise<TData>,
	timeoutMs: number,
): Promise<TData> {
	let timeoutId: ReturnType<typeof setTimeout> | undefined

	const timeoutPromise = new Promise<never>((_, reject) => {
		timeoutId = setTimeout(() => {
			reject(new Error("API timeout"))
		}, timeoutMs)
	})

	try {
		return await Promise.race([promise, timeoutPromise])
	} finally {
		if (timeoutId !== undefined) {
			clearTimeout(timeoutId)
		}
	}
}
