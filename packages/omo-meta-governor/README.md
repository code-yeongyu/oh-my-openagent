# @sisyphuslabs/omo-meta-governor

Self-judging agent orchestration layer for OpenCode. Observes tool executions,
reads session state, scores progress, and dispatches decisions.

## Install

```bash
npm install @sisyphuslabs/omo-meta-governor
```

## Usage

Add as a plugin in your OpenCode config:

```jsonc
{
  "plugins": ["@sisyphuslabs/omo-meta-governor"]
}
```

Configure:

```jsonc
{
  "meta_governor": {
    "enabled": true
  }
}
```

## How it works

After every tool call, MetaGovernor:
- Reads session signals (deviations, iteration budget, progress)
- Scores the session against weighted evidence
- Dispatches: `continue | warn | escalate | stop`

See [docs/guide/meta-governor.md](docs/guide/meta-governor.md) for full docs.

## License

MIT
