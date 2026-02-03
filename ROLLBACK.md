# Rollback Procedure - oh-my-opencode Custom Agent System

**Purpose**: Restore standard oh-my-opencode if custom agent system causes issues  
**Target Time**: <60 seconds  
**Difficulty**: Easy  

---

## Quick Rollback (Recommended)

### Step 1: Restore Standard Plugin (10 seconds)

Edit `~/.config/opencode/opencode.json`:

**Change FROM**:
```json
{
  "plugins": [
    "file:///Users/jay.jung/sub-project/oh-my-opencode"
  ]
}
```

**Change TO**:
```json
{
  "plugins": [
    "oh-my-opencode@latest"
  ]
}
```

Or simply remove the `plugins` array to use default.

### Step 2: Restart OpenCode (5 seconds)

```bash
# Exit current OpenCode session
# Start new session
opencode
```

### Step 3: Verify Standard Functionality (30 seconds)

Test standard agents:
```typescript
// Test oracle
delegate_task(subagent_type="oracle", prompt="What is 2+2?")
// Expected: "4"

// Test explore
delegate_task(subagent_type="explore", prompt="Search for 'export'")
// Expected: Search results

// Test librarian
delegate_task(subagent_type="librarian", prompt="What is React?")
// Expected: React documentation
```

**Total Time**: ~45 seconds

---

## Complete Rollback (If Quick Rollback Fails)

### Step 1: Uninstall Modified Plugin (15 seconds)

```bash
# If using bun link
cd ~/sub-project/oh-my-opencode
bun unlink

# If using global install
bun remove -g oh-my-opencode
```

### Step 2: Reinstall Standard Version (20 seconds)

```bash
bun install -g oh-my-opencode@3.2.1
```

### Step 3: Remove Custom Agent Config (5 seconds)

Edit `~/.config/opencode/oh-my-opencode.json`:

**Remove**:
```json
{
  "customAgents": {
    "git-owner": { ... }
  }
}
```

### Step 4: Restart OpenCode (5 seconds)

```bash
opencode
```

### Step 5: Verify (15 seconds)

Same as Quick Rollback Step 3.

**Total Time**: ~60 seconds

---

## Verification Checklist

After rollback, verify:

- [ ] OpenCode starts without errors
- [ ] No Zod validation errors in logs
- [ ] `oracle` agent responds to queries
- [ ] `explore` agent performs searches
- [ ] `librarian` agent retrieves documentation
- [ ] `git-master` skill loads correctly
- [ ] `playwright` skill loads correctly
- [ ] No "custom agent" references in error messages

---

## Troubleshooting

### Issue: "Plugin not found" error

**Solution**:
```bash
# Clear plugin cache
rm -rf ~/.cache/opencode/plugins/

# Reinstall standard version
bun install -g oh-my-opencode@latest

# Restart OpenCode
```

### Issue: Zod validation errors persist

**Solution**:
```bash
# Reset config to defaults
mv ~/.config/opencode/oh-my-opencode.json ~/.config/opencode/oh-my-opencode.json.backup
# OpenCode will regenerate default config on next start
```

### Issue: Standard agents don't respond

**Solution**:
```bash
# Check OpenCode version
opencode --version

# Reinstall OpenCode CLI
bun install -g @code-yeongyu/opencode@latest

# Restart
```

---

## Restore Modified Plugin (After Rollback)

If you want to restore the custom agent system after rollback:

### Step 1: Update Plugin Path (5 seconds)

Edit `~/.config/opencode/opencode.json`:
```json
{
  "plugins": [
    "file:///Users/jay.jung/sub-project/oh-my-opencode"
  ]
}
```

### Step 2: Restore Custom Agent Config (5 seconds)

Edit `~/.config/opencode/oh-my-opencode.json`:
```json
{
  "customAgents": {
    "git-owner": {
      "model": "anthropic/claude-sonnet-4-5",
      "promptPath": "~/sub-project/domain-owners/git-owner/OWNER.md",
      "constraintsPath": "~/sub-project/domain-owners/git-owner/constraints.yaml",
      "decisionsPath": "~/sub-project/domain-owners/git-owner/decisions.jsonl"
    }
  }
}
```

### Step 3: Restart OpenCode (5 seconds)

**Total Time**: ~15 seconds

---

## Backup Locations

Before rollback, configs are backed up to:
- `~/.config/opencode/opencode.json.backup`
- `~/.config/opencode/oh-my-opencode.json.backup`

To restore from backup:
```bash
cp ~/.config/opencode/opencode.json.backup ~/.config/opencode/opencode.json
cp ~/.config/opencode/oh-my-opencode.json.backup ~/.config/opencode/oh-my-opencode.json
```

---

## Emergency Rollback (Nuclear Option)

If all else fails:

```bash
# Remove all OpenCode config
rm -rf ~/.config/opencode/

# Remove all OpenCode cache
rm -rf ~/.cache/opencode/

# Reinstall OpenCode
bun install -g @code-yeongyu/opencode@latest

# Reinstall oh-my-opencode
bun install -g oh-my-opencode@latest

# Start fresh
opencode
```

**Warning**: This removes ALL OpenCode configuration. You'll need to reconfigure agents, models, etc.

---

## Rollback Testing Log

**Date**: ___________  
**Tester**: ___________  
**Method Used**: Quick / Complete / Emergency  
**Time Taken**: _____ seconds  
**Success**: Yes / No  
**Issues Encountered**: ___________  
**Notes**: ___________  

---

## Support

If rollback fails or you encounter issues:

1. **Check logs**: `~/.cache/opencode/logs/`
2. **Check this document**: Troubleshooting section above
3. **File issue**: GitHub repository (if applicable)
4. **Contact**: Project maintainer

---

## Rollback Success Criteria

✅ Rollback is successful when:
1. OpenCode starts without errors
2. All standard agents respond correctly
3. No custom agent references in errors
4. Time taken is <60 seconds
5. No data loss or corruption

❌ Rollback failed if:
1. OpenCode won't start
2. Standard agents don't respond
3. Persistent Zod validation errors
4. Time taken is >60 seconds

In case of failure, use Complete Rollback or Emergency Rollback.
