<!-- atlas-cloud:start -->
## ☁️ Atlas Cloud

<div align="center">

  <a href="https://www.atlascloud.ai/?utm_source=github&utm_medium=link&utm_campaign=lazycodex">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset=".github/assets/atlas-cloud-logo-white.svg">
      <img src=".github/assets/atlas-cloud-logo.svg" alt="Atlas Cloud" width="200">
    </picture>
  </a>

</div>

LazyCodex registers Atlas Cloud as an OpenAI-compatible Codex Responses provider without changing your default model. Export the API key only in your environment, then select the provider and a model explicitly:

```bash
export ATLASCLOUD_API_KEY="..."
npx lazycodex-ai install
codex -m moonshotai/kimi-k3 -c 'model_provider="atlascloud"'
```

[Explore Atlas Cloud](https://www.atlascloud.ai/?utm_source=github&utm_medium=link&utm_campaign=lazycodex) or [view the coding plan](https://www.atlascloud.ai/console/coding-plan).
<!-- atlas-cloud:end -->
