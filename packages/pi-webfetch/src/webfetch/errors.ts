export class InvalidWebfetchUrlError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "InvalidWebfetchUrlError";
	}
}

export class WebfetchTimeoutError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "WebfetchTimeoutError";
	}
}

export class WebfetchResponseTooLargeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "WebfetchResponseTooLargeError";
	}
}

export class WebfetchAbortError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "WebfetchAbortError";
	}
}
