import globals from "globals"
import nextPlugin from "@next/eslint-plugin-next"
import prettier from "eslint-config-prettier/flat"
import tseslint from "typescript-eslint"

const nextCoreWebVitalsConfig = {
  name: "next/core-web-vitals",
  plugins: {
    "@next/next": nextPlugin,
  },
  rules: {
    ...nextPlugin.configs.recommended.rules,
    ...nextPlugin.configs["core-web-vitals"].rules,
  },
}

export default [
  {
    ignores: [".next/**", "out/**", "build/**", "next-env.d.ts"],
  },
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx,jsx}"],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.nodeBuiltin,
      },
    },
  },
  nextCoreWebVitalsConfig,
  prettier,
]
