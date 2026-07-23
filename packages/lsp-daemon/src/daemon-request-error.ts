export class DaemonRequestError extends Error {
	readonly requestWritten: boolean;
	constructor(message: string, requestWritten: boolean) {
		super(message);
		this.name = "DaemonRequestError";
		this.requestWritten = requestWritten;
	}
}

export class DaemonAuthenticationRejectedError extends DaemonRequestError {
	constructor() {
		super("daemon authentication failed before dispatch", true);
		this.name = "DaemonAuthenticationRejectedError";
	}
}

export class DaemonRequestCancelledError extends DaemonRequestError {
	constructor(requestWritten: boolean) {
		super("daemon request cancelled", requestWritten);
		this.name = "DaemonRequestCancelledError";
	}
}

export class DaemonRequestTimedOutError extends DaemonRequestError {
	readonly timeoutMs: number;
	constructor(requestWritten: boolean, timeoutMs: number) {
		super("daemon request timed out", requestWritten);
		this.name = "DaemonRequestTimedOutError";
		this.timeoutMs = timeoutMs;
	}
}
