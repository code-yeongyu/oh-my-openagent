export async function runDelegatedOmoCommand(parsed, options) {
	const invocation = buildDelegatedOmoInvocation(parsed);
	if (parsed.dryRun) {
		options.log(`bunx ${invocation.args.join(" ")}`);
		return;
	}
	await options.runCommand(invocation.command, invocation.args, { cwd: options.cwd });
}

export function buildDelegatedOmoInvocation(parsed) {
	const args = ["--package", "oh-my-openagent", "omo", parsed.command];
	if (parsed.command === "install") {
		args.push("--platform=codex");
		if (parsed.noTui) args.push("--no-tui");
		if (parsed.skipAuth) args.push("--skip-auth");
		if (parsed.autonomousPermissions === true) args.push("--codex-autonomous");
		if (parsed.autonomousPermissions === false) args.push("--no-codex-autonomous");
		if (parsed.repoRoot) args.push(`--repo-root=${parsed.repoRoot}`);
	} else if (parsed.command === "cleanup") {
		args.push("--platform=codex", ...parsed.args);
	} else {
		args.push(...parsed.args);
	}
	return { command: "bunx", args };
}
