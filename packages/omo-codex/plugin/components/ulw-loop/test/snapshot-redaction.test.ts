import { describe, expect, it } from "vitest";

import { redactSnapshotText } from "../src/snapshot.ts";

const credentialFixture = (prefix: string, suffix = "secret") => `${prefix}_${suffix}`;
const credentialPair = (name: string, value: string) => `${name}=${value}`;
const dashedFixture = (...parts: string[]) => parts.join("-");

const SECRET_FIXTURES = [
	"Authorization: Bearer abc.def",
	"authorization: bearer lowercase.secret",
	"Authorization: Basic dXNlcjpwYXNz",
	"Cookie: session=SECRET_VALUE",
	"cookie: session=lower-secret",
	"Set-Cookie: refresh=SECRET_VALUE",
	"set-cookie: refresh=lower-secret",
	credentialPair("OPENAI_API_KEY", dashedFixture("sk", "test", "secret")),
	credentialPair("api_key", dashedFixture("sk", "lower", "secret")),
	credentialPair("GITHUB_TOKEN", credentialFixture("ghp")),
	"token=standalone-secret",
	"DATABASE_PASSWORD=db-secret-value",
	"env_secret=lower-env-secret",
	"https://user:pass@example.com/path",
	"BEGIN TRANSCRIPT\nsecret transcript\nEND TRANSCRIPT",
	dashedFixture("sk", "test", "secret"),
	credentialFixture("ghp"),
	credentialFixture("gho"),
	credentialFixture("ghu"),
	credentialFixture("ghs"),
	credentialFixture("ghr"),
	credentialFixture("github_pat", "abc123"),
	dashedFixture("xoxa", "123", "secret"),
	dashedFixture("xoxb", "123", "secret"),
	dashedFixture("xoxp", "123", "secret"),
	dashedFixture("xoxr", "123", "secret"),
	dashedFixture("xoxs", "123", "secret"),
] as const;
const DEPRECATED_SECRET_MARKER = `${"[REDACTED"}:${"secret]"}`;
const DEPRECATED_URL_CREDENTIAL_MARKER = `${"[REDACTED:url"}_${"credentials]"}`;

describe("redactSnapshotText", () => {
	it.each([
		"Begin Transcript\nmixed-case transcript\nEnd Transcript",
		"begin transcript\nlowercase transcript\nend transcript",
	] as const)("#given %s #when redacting transcript text #then replaces the entire block", (fixture) => {
		const redacted = redactSnapshotText(fixture);

		expect(redacted).toBe("[REDACTED:transcript]");
	});

	it("#given common credential forms #when redacting text #then uses deterministic replacement kinds", () => {
		const redacted = redactSnapshotText(SECRET_FIXTURES.join("\n"));

		for (const fixture of SECRET_FIXTURES) {
			expect(redacted).not.toContain(fixture);
		}
		expect(redacted).toContain("[REDACTED:authorization]");
		expect(redacted).toContain("[REDACTED:cookie]");
		expect(redacted).toContain("[REDACTED:api-key]");
		expect(redacted).toContain("[REDACTED:token]");
		expect(redacted).toContain("[REDACTED:env-secret]");
		expect(redacted).toContain("[REDACTED:url-credential]");
		expect(redacted).toContain("[REDACTED:transcript]");
		expect(redacted).not.toContain(DEPRECATED_SECRET_MARKER);
		expect(redacted).not.toContain(DEPRECATED_URL_CREDENTIAL_MARKER);
	});
});
