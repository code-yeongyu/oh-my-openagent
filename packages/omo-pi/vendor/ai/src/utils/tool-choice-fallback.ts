function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function extractHttpStatus(error: unknown): number | undefined {
	if (!isRecord(error)) {
		return undefined;
	}

	const status = error.status;
	if (typeof status === "number") {
		return status;
	}

	const response = error.response;
	if (isRecord(response) && typeof response.status === "number") {
		return response.status;
	}

	return undefined;
}

function errorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	if (typeof error === "string") {
		return error;
	}
	return String(error);
}

export function isForcedToolChoiceUnsupportedError(error: unknown, sentForcedToolChoice: boolean): boolean {
	if (!sentForcedToolChoice || extractHttpStatus(error) !== 400) {
		return false;
	}

	const message = errorMessage(error);
	return (
		/tool[_\s-]?choices?\b.*?(not\s+compatible|incompatible|not\s+supported|unsupported)/is.test(message) ||
		/forces?\s+tool\s+use.*?(not\s+compatible|incompatible|not\s+supported|unsupported)/is.test(message) ||
		/does\s+not\s+support\s+forced\s+tool[_\s-]?choices?/is.test(message)
	);
}

export function omitToolChoiceParam<TParams extends { tool_choice?: unknown }>(params: TParams): TParams {
	const nextParams = { ...params };
	delete nextParams.tool_choice;
	return nextParams;
}
