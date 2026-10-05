// Every CLI-level test runs inside one explicit session scope: the CLI refuses to
// touch the unscoped .omo/ulw-loop root, so state and evidence live under this id.
export const CLI_TEST_SESSION_ID = "cli-test";
export const CLI_TEST_SCOPE = { sessionId: CLI_TEST_SESSION_ID } as const;
