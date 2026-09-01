import { describe, expect, it } from "vitest";
import { daemonFailureResult } from "../src/daemon-failure-result.js";
import {
	DaemonAuthenticationRejectedError,
	DaemonRequestCancelledError,
	DaemonRequestError,
	DaemonRequestTimedOutError,
} from "../src/daemon-request-error.js";
import { daemonTestPaths } from "./daemon-path-fixture.js";

const paths = daemonTestPaths("/tmp/lsp-daemon-failure-result");

function failureText(error: unknown): string {
	const result = daemonFailureResult(paths, error);
	expect(result.isError).toBe(true);
	return result.content[0]?.text ?? "";
}

describe("daemonFailureResult", () => {
	it("#given a caller-cancelled request #when mapping the failure #then it reports cancellation, not unreachability", () => {
		const text = failureText(new DaemonRequestCancelledError(true));

		expect(text).toContain("cancelled");
		expect(text).not.toContain("unreachable");
		expect(text).not.toContain("timed out");
	});

	it("#given a timed-out request #when mapping the failure #then it reports the timeout budget, not unreachability", () => {
		const text = failureText(new DaemonRequestTimedOutError(true, 30_000));

		expect(text).toContain("timed out");
		expect(text).toContain("30000ms");
		expect(text).not.toContain("unreachable");
	});

	it("#given a genuine transport failure #when mapping the failure #then it still reports the daemon as unreachable", () => {
		const text = failureText(new DaemonRequestError("daemon connection closed", true));

		expect(text).toContain("unreachable");
		expect(text).toContain("daemon connection closed");
	});

	it("#given an authentication rejection #when mapping the failure #then it reports unreachability, not cancellation or timeout", () => {
		const text = failureText(new DaemonAuthenticationRejectedError());

		expect(text).toContain("unreachable");
		expect(text).not.toContain("cancelled");
		expect(text).not.toContain("timed out");
	});

	it("#given a non-Error rejection value #when mapping the failure #then it stringifies the cause into the unreachable report", () => {
		const text = failureText("socket vanished");

		expect(text).toContain("unreachable");
		expect(text).toContain("socket vanished");
	});
});
