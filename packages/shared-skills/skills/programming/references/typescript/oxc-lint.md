# Default TypeScript / JavaScript lint and format setup

**Use oxlint + oxfmt with `no-em-dash-copy` and `require-suppression-reason` by default.** Strongly prefer this OXC toolchain for new projects. Retain ESLint, Prettier, or Biome only when the repository already uses them; do not migrate an existing toolchain as incidental cleanup.

## Install and run

```bash
bun add --dev oxlint@1.89.0 oxfmt@0.74.0 oxlint-tsgolint@7.0.2005
bunx oxlint --type-aware --deny-warnings
bunx oxfmt --check
bunx tsc --noEmit
```

The scaffold at `../../scripts/typescript/new-project.ts` copies the configs and plugin below. For manual setup, copy `.oxlintrc.json`, `.oxfmtrc.json`, and `lint/oxlint-plugin/` (including `LICENSE`) from `../../scripts/typescript/oxc/` into the project root. Merge the `tsconfig.json` flags into an existing project's config; copy that file only for a new project. The plugin is plain ESM JavaScript; use `"type": "module"` in `package.json`.

`--type-aware` requires the installed `oxlint-tsgolint` companion and a supported runtime/platform and TS project. Use it wherever supported. For syntax-only JS or an unsupported target, use `oxlint --deny-warnings`; retain the compiler gate for TS/checked JS and report that type-aware rules did not run. Type-aware lint does not replace `tsc --noEmit`. JS plugins are experimental, so keep these tested versions pinned and re-verify upgrades.

## Complete .oxlintrc.json

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["typescript", "import", "oxc"],
  "jsPlugins": [
    { "name": "programming", "specifier": "./lint/oxlint-plugin/index.js" }
  ],
  "categories": { "correctness": "error", "suspicious": "error" },
  "rules": {
    "typescript/no-explicit-any": "error",
    "typescript/no-non-null-assertion": "error",
    "typescript/consistent-type-imports": "error",
    "typescript/ban-ts-comment": [
      "error",
      { "ts-expect-error": true, "ts-ignore": true, "ts-nocheck": true, "ts-check": false }
    ],
    "typescript/no-empty-object-type": "error",
    "typescript/no-wrapper-object-types": "error",
    "typescript/no-floating-promises": "error",
    "typescript/no-misused-promises": "error",
    "typescript/switch-exhaustiveness-check": "error",
    "import/no-default-export": "error",
    "no-param-reassign": "error",
    "no-unused-vars": "error",
    "no-empty": "error",
    "no-fallthrough": "error",
    "prefer-const": "error",
    "programming/require-suppression-reason": "error"
  },
  "ignorePatterns": ["node_modules/**", "dist/**", "build/**", "coverage/**", "vendor/**"],
  "overrides": [
    {
      "files": ["src/**/*", "apps/*/src/**/*", "packages/*/src/**/*"],
      "rules": { "programming/no-em-dash-copy": "error" }
    },
    {
      "files": [
        "**/*.{test,spec}.*",
        "**/{test,tests,__tests__,fixtures,__fixtures__,_generated,vendor,vendored}/**",
        "**/*.{gen,generated}.*"
      ],
      "rules": { "programming/no-em-dash-copy": "off" }
    },
    {
      "files": ["src/index.ts", "lint/oxlint-plugin/*.js"],
      "rules": { "import/no-default-export": "off" }
    }
  ]
}
```

The final override is for Hono's required entrypoint export and the plugin API's default exports. Remove the `src/index.ts` exception in projects without that framework requirement. Adjust product globs to the repository's real source roots. Tests, fixtures, generated code, and vendored code are exempt from the copy rule, not from type strictness.

## Complete .oxfmtrc.json

```json
{
  "$schema": "./node_modules/oxfmt/configuration_schema.json",
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false,
  "semi": true,
  "singleQuote": false,
  "ignorePatterns": ["node_modules/**", "dist/**", "build/**", "coverage/**", "vendor/**"]
}
```

Use `oxfmt` to write formatting and `oxfmt --check` in CI. Keep lint/type suppression directives on their own lines; put a reason on the directive or a separate comment above, never join the directive to the code it covers.

## Local JavaScript plugin

The complete, copyable implementation lives in:

- [`index.js`](../../scripts/typescript/oxc/lint/oxlint-plugin/index.js): registers both rules.
- [`no-em-dash-copy.js`](../../scripts/typescript/oxc/lint/oxlint-plugin/no-em-dash-copy.js): visits string `Literal`, cooked `TemplateElement`, and `JSXText`. Escaped em dashes are caught; comments and regex literals are exempt.
- [`require-suppression-reason.js`](../../scripts/typescript/oxc/lint/oxlint-plugin/require-suppression-reason.js): checks oxlint/eslint disable directives and `@ts-expect-error`, `@ts-ignore`, `@ts-nocheck`. A reason follows the directive (`-- reason` for lint directives), or appears in a comment line above. Enable directives are exempt.
- [`LICENSE`](../../scripts/typescript/oxc/lint/oxlint-plugin/LICENSE): retain alongside copied code.

The copy diagnostic is exactly: "No em dashes in product copy. Use a period, comma, colon, or parentheses instead."

Rewrite paired em dashes as asides using parentheses or commas, not colon chains. Choose punctuation from the whole sentence rather than replacing each dash token mechanically. The rule deliberately does not auto-fix prose.

A reason is necessary, not permission to suppress an error. The strict TS config still bans type suppression directives even when explained. Fix the type; the reason rule additionally protects repositories where a justified exception is already allowed.

## Strictness mapping

Built-in names below were checked against oxlint **1.89.0**'s installed `configuration_schema.json` and by running the generated config. Re-check the installed schema or `oxlint --rules` before adding a rule; do not guess ESLint/Biome translations.

| Intent | Enforcement |
|---|---|
| No explicit `any` | `typescript/no-explicit-any` |
| No non-null assertions | `typescript/no-non-null-assertion` |
| Explicit type-only imports | `typescript/consistent-type-imports` + `verbatimModuleSyntax` |
| No TS suppressions | `typescript/ban-ts-comment` with all suppression directives banned |
| Named exports | `import/no-default-export`, with narrow framework/plugin exceptions |
| No parameter assignment | `no-param-reassign` |
| No unused variables or imports | `no-unused-vars` |
| No empty catches or switch fallthrough | `no-empty`, `no-fallthrough` |
| Prefer constant bindings | `prefer-const` |
| Avoid empty object and wrapper types | `typescript/no-empty-object-type`, `typescript/no-wrapper-object-types` |
| Await promises and avoid async callbacks in synchronous contracts | `typescript/no-floating-promises`, `typescript/no-misused-promises` (`--type-aware`) |
| Exhaustive discriminated unions | `typescript/switch-exhaustiveness-check` (`--type-aware`) + `assertNever` |
| No assertion escapes, enums, or catch-without-narrowing | Existing `check-no-excuse-rules.ts` audit; these are not claimed as built-in oxlint rules |

## Provenance and license

Source: **pingdotgg/t3code oxlint plugin at d7f3b72**; `no-em-dash-copy` from **t3code#23799**, `require-suppression-reason` from **t3code#16294**. This plain-JS port uses `sisyphuslabs/omo-relay`'s `lint/oxlint-plugin/{index,no-em-dash-copy,require-suppression-reason}.js`, with the local plugin namespace renamed to `programming`.

The upstream [license at d7f3b72](https://github.com/pingdotgg/t3code/blob/d7f3b72/LICENSE) is **MIT**, copyright (c) 2026 T3 Tools Inc. The full notice is shipped in the plugin's `LICENSE` and copied by the scaffold.

References: [JS plugins](https://oxc.rs/docs/guide/usage/linter/js-plugins.html), [type-aware lint](https://oxc.rs/docs/guide/usage/linter/type-aware.html), [oxlint config](https://oxc.rs/docs/guide/usage/linter/config.html), [oxfmt config](https://oxc.rs/docs/guide/usage/formatter/config.html).
