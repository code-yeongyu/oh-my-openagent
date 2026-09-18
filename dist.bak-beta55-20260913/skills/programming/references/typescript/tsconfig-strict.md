# Strict tsconfig + Biome

The canonical ultra-strict config. Copy-paste, then add your own paths.

---

## tsconfig.json

```jsonc
{
  "compilerOptions": {
    // ── Strict core ──────────────────────────────────────────
    "strict": true,                            // enables all strict* flags below
    // strict includes: strictNullChecks, strictFunctionTypes,
    // strictBindCallApply, strictPropertyInitialization,
    // noImplicitAny, noImplicitThis, alwaysStrict, useUnknownInCatchVariables

    // ── Additional strict flags (NOT included in "strict") ──
    "noUncheckedIndexedAccess": true,           // obj[key] is T | undefined, not T
    "exactOptionalPropertyTypes": true,         // { x?: string } !== { x: string | undefined }
    "noFallthroughCasesInSwitch": true,         // switch fall-through is an error
    "noPropertyAccessFromIndexSignature": true, // forces bracket notation for index sigs
    "forceConsistentCasingInFileNames": true,   // prevents case-sensitivity bugs on macOS/Win

    // ── Module system ────────────────────────────────────────
    "module": "ESNext",
    "moduleResolution": "bundler",
    "verbatimModuleSyntax": true,               // forces `import type` for type-only imports
    "isolatedModules": true,                    // safe for esbuild / swc / Bun transpilation
    "esModuleInterop": true,
    "resolveJsonModule": true,

    // ── Target ───────────────────────────────────────────────
    "target": "ESNext",
    "lib": ["ESNext"],

    // ── Emit ─────────────────────────────────────────────────
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src",

    // ── Performance ──────────────────────────────────────────
    "skipLibCheck": true,                       // skip checking .d.ts files for speed
    "incremental": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

### What each extra flag catches

| Flag | What it prevents |
|---|---|
| `noUncheckedIndexedAccess` | `arr[0]` is `T \| undefined`, not `T`. Forces you to check before using. |
| `exactOptionalPropertyTypes` | `{ x?: string }` means "missing or string", NOT "string \| undefined". Assigns `undefined` explicitly? Type error. |
| `noFallthroughCasesInSwitch` | Forgetting `break` / `return` in a switch case. |
| `noPropertyAccessFromIndexSignature` | `obj.foo` on `Record<string, X>` is an error. Use `obj["foo"]`. |
| `verbatimModuleSyntax` | Forces `import type { X }` for type-only imports. Prevents runtime import of types. |

### Bun-specific additions

For Bun projects, add to `compilerOptions`:
```jsonc
{
  "types": ["bun-types"],
  "moduleDetection": "force"
}
```

---

## biome.jsonc

```jsonc
{
  "$schema": "https://biomejs.dev/schemas/2.0.6/schema.json",
  "organizeImports": {
    "enabled": true
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "suspicious": {
        "noExplicitAny": "error",
        "noConfusingVoidType": "error",
        "noFallthroughSwitchClause": "error"
      },
      "style": {
        "noDefaultExport": "error",
        "useImportType": "error",
        "noNonNullAssertion": "error",
        "useEnumInitializers": "off",
        "noParameterAssign": "error"
      },
      "correctness": {
        "noUnusedVariables": "error",
        "noUnusedImports": "error"
      },
      "complexity": {
        "noBannedTypes": "error"
      }
    }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "double",
      "semicolons": "asNeeded"
    }
  },
  "files": {
    "ignore": ["node_modules", "dist", "build", ".next", ".nuxt", "coverage"]
  }
}
```

### Key Biome rules

| Rule | What |
|---|---|
| `noExplicitAny` | `any` in annotations is an error |
| `noNonNullAssertion` | `x!` is an error |
| `noDefaultExport` | Forces named exports |
| `useImportType` | Forces `import type` for type-only imports |
| `noParameterAssign` | No mutation of function parameters |

---

## CI gate

```bash
bunx biome check .
bunx tsc --noEmit
bun test
```

---

## Sources

- TypeScript: [tsconfig reference](https://www.typescriptlang.org/tsconfig)
- Biome: [configuration](https://biomejs.dev/reference/configuration/)
- Total TypeScript: [tsconfig cheat sheet](https://www.totaltypescript.com/tsconfig-cheat-sheet)
