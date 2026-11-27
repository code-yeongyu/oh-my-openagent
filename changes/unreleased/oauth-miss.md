Fixed automatic memory reflection retrying a revoked or expired OAuth login as if it were transient: the child's OAuth refresh failure is now classified as a dead credential on that provider, so the reflection model chain moves to the next candidate, and if none works the run parks immediately with a warning that names the provider and the category config key.

<!-- changes-log: changes/unreleased/oauth-miss.md -->
