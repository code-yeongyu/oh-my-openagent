### Changed

- `thread_send` and `thread_handoff` to a session on another device now cost one relay round trip instead of two: the prompt goes out first as a follow-up, and the other device's engine decides whether it starts a turn or waits behind the running one, so no state read precedes it. Every result is unchanged; a steer still reads the session's state first.
