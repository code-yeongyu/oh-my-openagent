// @oh-my-opencode/omo-gateway - chat-surface gateway (scaffold).
//
// This package owns the gateway that routes Slack, Discord, Telegram and Notion conversations
// into omo sessions: surface adapters, the connector host, admission (identity + roles), dispatch
// + lead + work items, and the conversation-rules layer. It is deliberately a scaffold today -
// todos 3-10 of the gateway plan fill src/ - and two contracts already bind:
//
// 1. It is NEVER imported on the omo startup path. The only sanctioned import site is a lazy
//    `import()` inside packages/omo-native/bin/lib/gateway.js; with no `gateway` section in
//    omo.json nothing here loads and nothing runs.
// 2. It sits ON the session-gateway library (one store, one identity table, one chat-thread to
//    session map) and never re-implements any of it.
//
// See AGENTS.md in this directory for the invariants and the agent-messenger dependency audit.
