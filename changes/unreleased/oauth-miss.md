Automatic memory reflection now tries the next model when an OAuth login reports `invalid_grant`. If every candidate has a missing or revoked login, reflection parks on the first failure and names the provider login and category setting to fix. Network and service errors remain retryable.

<!-- changes-log: changes/unreleased/oauth-miss.md -->
