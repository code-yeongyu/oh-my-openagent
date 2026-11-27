// How a git child process authenticates to GitHub with this SDK's token, so clone and fetch need no gh login
// and no credential helper of the user's. The token travels only in the child's environment: never in argv,
// the remote URL or .git/config.
const TOKEN_VAR = "GITHUB_SDK_GIT_TOKEN";
const HOSTS = ["github.com", "gist.github.com"] as const;
const HELPER = `!f() { test "$1" = get && printf 'username=x-access-token\\npassword=%s\\n' "$${TOKEN_VAR}"; }; f`;

// Git reads GIT_CONFIG_KEY_n / GIT_CONFIG_VALUE_n after its config files. An empty helper value clears the
// helpers configured for that host, so only ours answers and no stored credential is read or rewritten.
const TOKEN_VARS: ReadonlySet<string> = new Set([
  "GH_TOKEN",
  "GITHUB_TOKEN",
  TOKEN_VAR,
]);

// A checkout's hooks, filters and aliases run inside git children, so no git child inherits the
// token variables this process may hold. `auth` is added back only for a command that reaches the remote.
export const gitChildEnv = (
  base: Readonly<Record<string, string | undefined>>,
  auth: Readonly<Record<string, string>>,
): Record<string, string> => ({
  ...Object.fromEntries(
    Object.entries(base).flatMap(([name, value]) =>
      value === undefined || TOKEN_VARS.has(name) ? [] : [[name, value]],
    ),
  ),
  ...auth,
});

export const gitAuthEnv = (token: string): Record<string, string> => {
  const pairs = HOSTS.flatMap((host) => [
    [`credential.https://${host}.helper`, ""],
    [`credential.https://${host}.helper`, HELPER],
  ]);
  return {
    [TOKEN_VAR]: token,
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: String(pairs.length),
    ...Object.fromEntries(
      pairs.flatMap(([key, value], i) => [
        [`GIT_CONFIG_KEY_${i}`, key],
        [`GIT_CONFIG_VALUE_${i}`, value],
      ]),
    ),
  };
};
