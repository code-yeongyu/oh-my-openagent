# Changelog: 2025-12-18

**Agent**: Quick Fixer
**Scope**: hook-config-undefined-fix
**Type**: Bug Fix

## Summary

Fixed critical runtime error `undefined is not an object (evaluating 'allowListPatterns')` that occurred when governance hooks were initialized with undefined config values.

## Root Cause

When hooks were created with partial config objects containing `undefined` values, the spread operator `{ ...DEFAULT_CONFIG, ...config }` would overwrite default array values (like `allowListPatterns: []`) with `undefined`. Later code attempting to iterate over these arrays would crash.

## Files Changed

- `~` src/hooks/git-safety-validator/index.ts - Filter undefined config values before merging
- `~` src/hooks/git-safety-validator/validator.ts - Filter undefined config values before merging
- `~` src/hooks/security-scanner/index.ts - Filter undefined config values before merging
- `~` src/hooks/conflict-detector/index.ts - Filter undefined config values before merging

## Technical Details

Changed config merging pattern from:
```typescript
const fullConfig = { ...DEFAULT_CONFIG, ...config };
```

To:
```typescript
const fullConfig = {
  ...DEFAULT_CONFIG,
  ...(config?.field !== undefined && { field: config.field }),
};
```

This ensures only defined values override defaults, preventing `undefined` from overwriting default arrays/objects.

## Impact

- Fixes plugin crash when governance hooks are enabled without explicit configuration
- All governance hooks (git-safety-validator, security-scanner, conflict-detector) now work correctly with partial or missing config
