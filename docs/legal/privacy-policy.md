# Privacy Policy

Last updated: May 2, 2026

This Privacy Policy explains how oh-my-opencode and oh-my-openagent collect, use, and protect information related to the published CLI package, the OpenCode plugin, and the project website or repository materials where they apply.

For this policy, "Application" means the published `oh-my-opencode` CLI package and the OpenCode plugin runtime it installs. "Service" means the Application and the project distribution surfaces together. "We" and "our" refer to the maintainer of oh-my-opencode. "You" refers to a user of the Service.

By using the Service, you accept this Privacy Policy and the accompanying Terms of Service in [terms-of-service.md](./terms-of-service.md).

## 1. Information We Collect

We collect limited non-personal information needed to operate and improve the Service.

### Automatically collected information

When anonymous telemetry is enabled, the Application may collect a single anonymous usage event:

- `omo_daily_active`, sent at most once per UTC day per machine when the plugin loads or when the `run` CLI is invoked, used to estimate daily, weekly, and monthly active installations
- Anonymous machine metadata bundled with that event, such as package version, plugin name, runtime, OS family, locale, and timezone
- A pseudonymous installation identifier derived from a one-way hash of the local hostname

The Application does not create or update PostHog person profiles, and does not collect prompt contents, source files, repository contents, access tokens, API keys, raw hostnames, or runtime error diagnostics through this telemetry path.

### Configuration and local state

The Application stores local configuration and telemetry deduplication state on your machine to support installation, configuration, and anonymous daily active tracking.

## 2. How Telemetry Works

The Application uses PostHog for anonymous product analytics. Telemetry is enabled by default, following the same opt-out posture used in cmux, and is intended only to estimate active installations (daily, weekly, and monthly) so we can understand broad adoption.

Telemetry can be disabled at any time by setting one of these environment variables before running the CLI or plugin host:

```bash
export OMO_SEND_ANONYMOUS_TELEMETRY=0
# or
export OMO_DISABLE_POSTHOG=1
```

When telemetry is disabled, PostHog events are not sent.

## 3. Third-Party Services

The Service may use third-party providers including:

- **PostHog** for anonymous product analytics
- **npm** and **GitHub** for package distribution, releases, and repository hosting
- **OpenCode** and model providers that you configure separately for your own agent usage

Each third-party service has its own terms and privacy practices.

## 4. How We Use Information

We use collected information to:

- Estimate daily, weekly, and monthly active installations
- Understand aggregate adoption across operating systems and package versions
- Maintain and evolve the Service

We do not sell personal information collected through this telemetry path.

## 5. Data Retention

Anonymous analytics are retained only as long as reasonably necessary for understanding adoption. Local telemetry state stored on your machine remains there until removed by you.

## 6. Your Choices

You may:

- Disable anonymous telemetry through environment variables
- Remove local configuration or cached state files from your machine
- Stop using the Service at any time

## 7. Security

We use reasonable administrative and technical measures to protect the systems we control. No method of transmission or storage is completely secure.

## 8. Changes to This Policy

We may update this Privacy Policy from time to time. Material updates will be reflected by revising the date at the top of this document.

## 9. Contact

Questions about this Privacy Policy should be raised through the project repository issue tracker or the maintainer contact channels published in the repository.
