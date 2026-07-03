import type { IncomingHttpHeaders } from "node:http";
import { request } from "undici";

import {
	InvalidWebfetchUrlError,
	WebfetchAbortError,
	WebfetchResponseTooLargeError,
	WebfetchTimeoutError,
} from "./errors.ts";

export const MAX_RESPONSE_SIZE_BYTES = 5 * 1024 * 1024;
export const DEFAULT_TIMEOUT_SECONDS = 30;
export const MAX_TIMEOUT_SECONDS = 120;
const MAX_REDIRECTS = 20;

const BROWSER_USER_AGENT =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";
const CHROME_MAJOR_VERSION = "143";
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

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

interface HttpResponse {
	readonly url: string;
	readonly status: number;
	readonly statusText: string;
	readonly headers: IncomingHttpHeaders;
	readonly body: ResponseBodyStream;
}

interface ResponseBodyStream extends AsyncIterable<unknown> {
	destroy(error?: Error): void;
	dump(options?: { limit: number; signal?: AbortSignal }): Promise<void>;
}

export async function fetchUrl(options: FetchOptions): Promise<FetchResult> {
	validateUrl(options.url);

	const timeoutSeconds = clampTimeout(options.timeoutSeconds);
	const timeoutMs = timeoutSeconds * 1000;
	const controller = new AbortController();
	const timeout = setTimeout(
		() => controller.abort(new WebfetchTimeoutError(`Request timed out after ${timeoutSeconds}s`)),
		timeoutMs,
	);
	const removeAbortForwarder = forwardAbort(options.signal, controller);

	try {
		const response = await requestUrl({
			url: options.url,
			format: options.format,
			signal: controller.signal,
			timeoutMs,
		});

		return await readHttpResponse(response, controller.signal);
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

function buildHeaders(format: WebfetchFormat): Record<string, string> {
	return {
		Accept: buildAcceptHeader(format),
		"Accept-Language": "en-US,en;q=0.9",
		"Sec-CH-UA": `"Google Chrome";v="${CHROME_MAJOR_VERSION}", "Chromium";v="${CHROME_MAJOR_VERSION}", "Not A(Brand";v="24"`,
		"Sec-CH-UA-Mobile": "?0",
		"Sec-CH-UA-Platform": '"Windows"',
		"Sec-Fetch-Dest": "document",
		"Sec-Fetch-Mode": "navigate",
		"Sec-Fetch-Site": "none",
		"Sec-Fetch-User": "?1",
		"Upgrade-Insecure-Requests": "1",
		"User-Agent": BROWSER_USER_AGENT,
	};
}

interface RequestUrlOptions {
	readonly url: string;
	readonly format: WebfetchFormat;
	readonly signal: AbortSignal;
	readonly timeoutMs: number;
}

async function requestUrl(options: RequestUrlOptions): Promise<HttpResponse> {
	const headers = buildHeaders(options.format);
	let currentUrl = options.url;

	for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
		const response = await request(currentUrl, {
			method: "GET",
			headers,
			signal: options.signal,
			headersTimeout: options.timeoutMs,
			bodyTimeout: options.timeoutMs,
		});

		if (!REDIRECT_STATUSES.has(response.statusCode)) {
			return {
				url: currentUrl,
				status: response.statusCode,
				statusText: response.statusText,
				headers: response.headers,
				body: response.body,
			};
		}

		const location = getHeader(response.headers, "location");
		if (!location) {
			return {
				url: currentUrl,
				status: response.statusCode,
				statusText: response.statusText,
				headers: response.headers,
				body: response.body,
			};
		}

		if (redirectCount === MAX_REDIRECTS) {
			return {
				url: currentUrl,
				status: response.statusCode,
				statusText: response.statusText,
				headers: response.headers,
				body: response.body,
			};
		}

		await discardBody(response.body);
		currentUrl = new URL(location, currentUrl).toString();
	}

	throw new WebfetchAbortError("Redirect resolution aborted");
}

async function readHttpResponse(response: HttpResponse, signal: AbortSignal): Promise<FetchResult> {
	await rejectOversizedContentLength(response);
	const body = await readResponseBody(response, signal);
	return {
		url: response.url,
		status: response.status,
		statusText: response.statusText,
		contentType: getHeader(response.headers, "content-type"),
		bytes: body.length,
		body,
		truncated: body.length === MAX_RESPONSE_SIZE_BYTES,
	};
}

async function rejectOversizedContentLength(response: HttpResponse): Promise<void> {
	const contentLength = getHeader(response.headers, "content-length");
	if (contentLength && Number.parseInt(contentLength, 10) > MAX_RESPONSE_SIZE_BYTES) {
		await discardBody(response.body);
		throw new WebfetchResponseTooLargeError("Response too large (exceeds 5MB limit)");
	}
}

function getHeader(headers: IncomingHttpHeaders, name: string): string {
	const value = headers[name.toLowerCase()];
	if (Array.isArray(value)) return value.join(", ");
	return value ?? "";
}

async function discardBody(body: ResponseBodyStream): Promise<void> {
	try {
		await body.dump({ limit: 1024 });
	} catch (error) {
		if (error instanceof Error) {
			body.destroy(error);
			return;
		}
		throw error;
	}
}

async function readResponseBody(response: HttpResponse, signal: AbortSignal): Promise<Uint8Array> {
	const chunks: Uint8Array[] = [];
	let total = 0;

	try {
		for await (const chunk of response.body) {
			if (signal.aborted) {
				response.body.destroy();
				throw new WebfetchAbortError("Request aborted");
			}
			const bytes = toUint8Array(chunk);
			chunks.push(bytes);
			total += bytes.length;
			if (total > MAX_RESPONSE_SIZE_BYTES) {
				response.body.destroy();
				throw new WebfetchResponseTooLargeError("Response too large (exceeds 5MB limit)");
			}
		}
	} catch (error) {
		if (signal.aborted) {
			throw new WebfetchAbortError("Request aborted");
		}
		throw error;
	}

	const body = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.length;
	}
	return body;
}

function toUint8Array(chunk: unknown): Uint8Array {
	if (chunk instanceof Uint8Array) return chunk;
	if (typeof chunk === "string") return new TextEncoder().encode(chunk);
	throw new Error("Unexpected response body chunk");
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
