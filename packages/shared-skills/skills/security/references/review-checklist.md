# Security review: the questions and the completion claim

## 1. Questions shaped by the OWASP Top 10

Ask each question against the boundary the change touched. A "no" with a reason is an answer; a question skipped is an open row.

| Area | Question | Typical control |
|---|---|---|
| Access control | Can a caller reach an object they do not own by changing an identifier? Is every route's authorization decided server-side, by the identity in the session rather than by a field in the request? | ownership scoped in the query; deny by default; tests that try the neighbor's id |
| Cryptography | Is anything sensitive stored or sent in clear? Are passwords hashed with a slow, salted algorithm? Are tokens random from a CSPRNG and compared in constant time? | TLS everywhere; argon2 or bcrypt; `crypto.timingSafeEqual` |
| Injection | Does any user-controlled string reach SQL, a shell, a template, a path, a header, an LDAP or XML parser, or a prompt without being parsed and bound? | parameterized queries; argv arrays, never shell strings; path normalization and a root check; output encoding per context |
| Insecure design | Does the flow have a step an attacker can skip, replay, or race? Are limits (size, count, rate, money) enforced where the state changes? | idempotency keys; server-side limits; state machines that reject out-of-order steps |
| Misconfiguration | Are debug endpoints, default credentials, verbose errors, directory listings, or permissive CORS reachable? Did the change widen a permission, a port, or a sandbox? | production config reviewed; errors generic to the client; headers checked with one request |
| Vulnerable components | Did a dependency enter or change? Does it have an advisory? Is the lockfile consistent? | `npm audit` / `pip-audit` output quoted; the slopsquatting gate for AI-suggested names |
| Authentication | Can a session be fixed, guessed, kept alive forever, or reused after logout and password change? Is MFA or rate limiting on the login and reset paths? | rotate the session id on login; absolute and idle expiry; invalidate on credential change |
| Integrity | Does the code load something at runtime (a script, an update, a plugin, an MCP server) without a pinned version and a verified hash or signature? Does the CI pipeline trust an input it should not? | pinned versions; signature or digest checks; signed artifacts |
| Logging and monitoring | Are security events (login failure, authorization denial, admin action) logged with enough context and without secrets or personal data? Will someone see them? | structured logs with redaction; alerts on thresholds |
| Server-side requests | Can user input choose a URL the server fetches? Is the internal network reachable from that fetch? | allowlist of hosts; block private ranges; no redirects followed blindly |

Agent harnesses add two rows: prompt injection (does retrieved text reach the model with the authority of an instruction, and can it trigger a tool call?) and tool poisoning (does a tool's output get executed or written to config without validation?).

## 2. What the completion claim owes

Saying the change is secure means these are in the report:

1. The threat model's six lines, each boundary marked covered or open, with the control that covers it.
2. The scanner output lines the repository standardizes on (SAST, dependency audit, secret scan), quoted, with their exit status.
3. The manual probes that were run against the real surface, one line each: the request or command, what came back, and which row of section 1 it answers.
4. Every finding with trigger, impact, `file:line`, remediation, and `verified` or `unverified`.
5. The things not checked, named, so the next reader does not assume they were.

Severity follows the attack path, not the category: Critical is an exploitable flaw with data loss, takeover or outage; High is a correctness or security defect that reaches users; Medium is bounded; Low has limited impact; Style never changes a verdict. An unresolved Critical or High blocks. A Medium is fixed before merge unless the author marks it non-blocking with a reason and a tracked follow-up.

## 3. Language notes worth a second look

- JavaScript and TypeScript: prototype pollution through object merges of untrusted JSON, `eval`-family and `new Function`, regular expressions with nested quantifiers on untrusted input, `child_process` with a shell string, `fetch` following redirects into internal hosts.
- Python: `pickle` and `yaml.load` on untrusted data, `subprocess` with `shell=True`, string-built SQL, `tarfile.extractall` without member checks.
- SQL: string concatenation anywhere; `LIKE` patterns built from input; privileges of the application role.
- Go: `html/template` versus `text/template` for HTML output, `exec.Command` argument handling, unchecked errors on security decisions, integer conversion on sizes from the network.
