import tseslint from "typescript-eslint"

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "web/**",
      ".local-ignore/**",
      ".sisyphus/**",
      "tests/hashline/**",
      "packages/**",
      "assets/**",
      "docs/**",
      "postinstall.mjs",
    ],
  },
  {
    files: ["src/**/*.ts", "bin/**/*.ts", "script/**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: false,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": "error",
      "prefer-const": "error",
      "no-var": "error",
    },
  },
  // Test files may use `as any` for mock objects per project convention;
  // prefer-const/no-var are also relaxed since tests have different standards.
  {
    files: ["**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "prefer-const": "warn",
    },
  },
  // Self-referencing async IIFE requires let (TDZ workaround).
  {
    files: ["src/features/skill-mcp-manager/connection.ts"],
    rules: {
      "prefer-const": "off",
    },
  },
]
