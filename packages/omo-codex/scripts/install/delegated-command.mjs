export async function runDelegatedOmoCommand(parsed, options) {
	const invocation = buildDelegatedOmoInvocation(parsed);
	if (parsed.dryRun) {
		options.log(`${invocation.command} ${invocation.args.join(" ")}`);
		return;
	}
	// The lazycodex wrapper sets OMO_INVOCATION_NAME=lazycodex to route into this
	// Codex installer path. The delegated `omo` process must NOT inherit that name,
	// otherwise it re-enters the lazycodex installer and recurses forever.
	const env = { ...process.env, OMO_INVOCATION_NAME: "omo" };
	await options.runCommand(invocation.command, invocation.args, { cwd: options.cwd, env });
}

export function buildDelegatedOmoInvocation(parsed) {
	const args = ["--yes", "--package", "oh-my-openagent", "omo", parsed.command];
	if (parsed.command === "install") {
		args.push("--platform=codex");
		if (parsed.noTui) args.push("--no-tui");
		if (parsed.skipAuth) args.push("--skip-auth");
		if (parsed.autonomousPermissions !== false) args.push("--codex-autonomous");
		if (parsed.autonomousPermissions === false) args.push("--no-codex-autonomous");
		if (parsed.repoRoot) args.push(`--repo-root=${parsed.repoRoot}`);
	} else if (parsed.command === "cleanup") {
		args.push("--platform=codex", ...parsed.args);
	} else {
		args.push(...parsed.args);
	}
	return { command: "npx", args };
}
