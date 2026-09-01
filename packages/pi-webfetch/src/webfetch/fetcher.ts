import {
	InvalidWebfetchUrlError,
	WebfetchAbortError,
	WebfetchResponseTooLargeError,
	WebfetchTimeoutError,
} from "./errors.js";

export const MAX_RESPONSE_SIZE_BYTES = 5 * 1024 * 1024;
export const DEFAULT_TIMEOUT_SECONDS = 30;
export const MAX_TIMEOUT_SECONDS = 120;

const BROWSER_USER_AGENT =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";

export type WebfetchFormat = "markdown" | "text" | "html";

export interface FetchOptions {
	url: string;
	format: WebfetchFormat;
	timeoutSeconds?: number;
	signal?: AbortSignal;
}

export interface FetchResult {
	url: string;
	status: number;
	statusText: string;
	contentType: string;
	bytes: number;
	body: Uint8Array;
	truncated: boolean;
}

export async function fetchUrl(options: FetchOptions): Promise<FetchResult> {
	validateUrl(options.url);

	const timeoutSeconds = clampTimeout(options.timeoutSeconds);
	const controller = new AbortController();
	const timeout = setTimeout(
		() => controller.abort(new WebfetchTimeoutError(`Request timed out after ${timeoutSeconds}s`)),
		timeoutSeconds * 1000,
	);
	const removeAbortForwarder = forwardAbort(options.signal, controller);

	try {
		const response = await fetch(options.url, {
			headers: buildHeaders(options.format, BROWSER_USER_AGENT),
			signal: controller.signal,
		});

		if (response.status === 403 && response.headers.get("cf-mitigated") === "challenge") {
			await cancelBody(response);
			const retry = await fetch(options.url, {
				headers: buildHeaders(options.format, "pi-webfetch"),
				signal: controller.signal,
			});
			return await readFetchResponse(options.url, retry, controller.signal);
		}

		return await readFetchResponse(options.url, response, controller.signal);
	} finally {
		clearTimeout(timeout);
		removeAbortForwarder();
	}
}

export function validateUrl(url: string): void {
	if (!url.startsWith("http://") && !url.startsWith("https://")) {
		throw new InvalidWebfetchUrlError("URL must start with http:// or https://");
	}

	try {
		new URL(url);
	} catch {
		throw new InvalidWebfetchUrlError(`Invalid URL: ${url}`);
	}
}

export function clampTimeout(timeoutSeconds: number | undefined): number {
	if (timeoutSeconds === undefined) return DEFAULT_TIMEOUT_SECONDS;
	if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) return DEFAULT_TIMEOUT_SECONDS;
	return Math.min(Math.ceil(timeoutSeconds), MAX_TIMEOUT_SECONDS);
}

export function buildAcceptHeader(format: WebfetchFormat): string {
	switch (format) {
		case "markdown":
			return "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1";
		case "text":
			return "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1";
		case "html":
			return "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1";
	}
}

function buildHeaders(format: WebfetchFormat, userAgent: string): HeadersInit {
	return {
		Accept: buildAcceptHeader(format),
		"Accept-Language": "en-US,en;q=0.9",
		"User-Agent": userAgent,
	};
}

async function readFetchResponse(url: string, response: Response, signal: AbortSignal): Promise<FetchResult> {
	await rejectOversizedContentLength(response);
	const body = await readResponseBody(response, signal);
	return {
		url: response.url || url,
		status: response.status,
		statusText: response.statusText,
		contentType: response.headers.get("content-type") ?? "",
		bytes: body.length,
		body,
		truncated: body.length === MAX_RESPONSE_SIZE_BYTES,
	};
}

async function rejectOversizedContentLength(response: Response): Promise<void> {
	const contentLength = response.headers.get("content-length");
	if (contentLength && Number.parseInt(contentLength, 10) > MAX_RESPONSE_SIZE_BYTES) {
		await cancelBody(response);
		throw new WebfetchResponseTooLargeError("Response too large (exceeds 5MB limit)");
	}
}

async function cancelBody(response: Response): Promise<void> {
	try {
		await response.body?.cancel();
	} catch {
		// Preserve the caller's original failure.
	}
}

async function readResponseBody(response: Response, signal: AbortSignal): Promise<Uint8Array> {
	if (!response.body) return new Uint8Array();

	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;

	try {
		while (true) {
			if (signal.aborted) {
				await cancelReader(reader);
				throw new WebfetchAbortError("Request aborted");
			}
			const read = await reader.read();
			if (read.done) break;
			chunks.push(read.value);
			total += read.value.length;
			if (total > MAX_RESPONSE_SIZE_BYTES) {
				await cancelReader(reader);
				throw new WebfetchResponseTooLargeError("Response too large (exceeds 5MB limit)");
			}
		}
	} finally {
		reader.releaseLock();
	}

	const body = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.length;
	}
	return body;
}

async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
	try {
		await reader.cancel();
	} catch {
		// Preserve the caller's original failure.
	}
}

function forwardAbort(signal: AbortSignal | undefined, controller: AbortController): () => void {
	if (!signal) return () => {};
	if (signal.aborted) {
		controller.abort(signal.reason);
		return () => {};
	}

	const listener = (): void => controller.abort(signal.reason);
	signal.addEventListener("abort", listener, { once: true });
	return () => signal.removeEventListener("abort", listener);
}
