export function abortedErrorLabel(persisted: string | undefined, retryAttempt: number): string {
	if (persisted) return persisted;
	return retryAttempt > 0
		? `Aborted after ${retryAttempt} retry attempt${retryAttempt > 1 ? "s" : ""}`
		: "Operation aborted";
}
