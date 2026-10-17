import { fixupConfigRules } from "@eslint/compat"
import nextVitals from "eslint-config-next/core-web-vitals"
import prettier from "eslint-config-prettier/flat"
import tseslint from "typescript-eslint"

const config = [
  ...fixupConfigRules(nextVitals),
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx,jsx}"],
    languageOptions: { parser: tseslint.parser },
  },
  prettier,
]

export default config
