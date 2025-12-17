# Release Notes - v{X.Y.Z}

## Overview

**Release Date**: {YYYY-MM-DD}
**Release Type**: {Major | Minor | Patch}
**Linear Milestone**: {Milestone name}

### Summary
{2-3 sentence summary of this release}

## Highlights

### 🎉 New Features
- **{Feature 1}**: {Brief description}
- **{Feature 2}**: {Brief description}

### 🐛 Bug Fixes
- **{Fix 1}**: {Brief description}
- **{Fix 2}**: {Brief description}

### ⚡ Improvements
- **{Improvement 1}**: {Brief description}
- **{Improvement 2}**: {Brief description}

## Detailed Changes

### Features

#### {Feature Name} ({LINEAR-ID})
{Detailed description of the feature}

**How to use:**
```typescript
// Example code
```

**Configuration:**
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| {option} | {type} | {default} | {description} |

---

### Bug Fixes

#### {Bug Title} ({LINEAR-ID})
**Problem**: {Description of the bug}
**Solution**: {How it was fixed}
**Impact**: {Who was affected}

---

### Improvements

#### {Improvement Title} ({LINEAR-ID})
**Before**: {Previous behavior}
**After**: {New behavior}
**Benefit**: {Why this is better}

---

## Breaking Changes

⚠️ **This release contains breaking changes**

### {Breaking Change 1}

**What changed**: {Description}

**Migration steps**:
1. {Step 1}
2. {Step 2}
3. {Step 3}

**Before**:
```typescript
// Old code
```

**After**:
```typescript
// New code
```

---

## Deprecations

The following features are deprecated and will be removed in a future release:

| Feature | Deprecated In | Removal Target | Alternative |
|---------|---------------|----------------|-------------|
| {feature} | v{X.Y.Z} | v{X.Y.Z} | {alternative} |

---

## Dependencies

### Updated
| Package | Previous | New |
|---------|----------|-----|
| {package} | {version} | {version} |

### Added
- {package}@{version}: {reason}

### Removed
- {package}: {reason}

---

## Performance

### Improvements
- {Metric 1}: {X}% improvement
- {Metric 2}: {X}% improvement

### Benchmarks
| Operation | v{previous} | v{current} | Change |
|-----------|-------------|------------|--------|
| {operation} | {time} | {time} | {%} |

---

## Security

### Vulnerabilities Fixed
- **{CVE-ID}**: {Description} (Severity: {High|Medium|Low})

### Security Improvements
- {Improvement 1}
- {Improvement 2}

---

## Known Issues

| Issue | Description | Workaround |
|-------|-------------|------------|
| {LINEAR-ID} | {Description} | {Workaround} |

---

## Upgrade Guide

### Prerequisites
- Node.js {version} or higher
- {Other prerequisites}

### Steps

1. **Backup your data**
   ```bash
   npm run db:backup
   ```

2. **Update package**
   ```bash
   npm update {package}@{version}
   ```

3. **Run migrations**
   ```bash
   npm run db:migrate
   ```

4. **Verify installation**
   ```bash
   npm run health-check
   ```

### Rollback

If you encounter issues:
```bash
npm install {package}@{previous-version}
npm run db:migrate:rollback
```

---

## Contributors

Thanks to everyone who contributed to this release:

- @{username} - {contribution}
- @{username} - {contribution}

---

## Links

- [Full Changelog]({{integrations.github.repo}}/compare/v{previous}...v{current})
- [Documentation](https://docs.{project.domain}/changelog)
- [NPM Package](https://www.npmjs.com/package/{project.name})
- [Docker Image](https://ghcr.io/{org}/{project.name})

---

## Feedback

We'd love to hear your feedback on this release!

- [GitHub Discussions]({{integrations.github.repo}}/discussions)
- [GitHub Issues]({{integrations.github.repo}}/issues)

