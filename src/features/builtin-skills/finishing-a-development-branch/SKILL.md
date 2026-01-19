---
name: finishing-a-development-branch
description: Use when implementation is complete, all tests pass, and you need to decide how to integrate the work - guides completion of development work by presenting structured options for merge, PR, or cleanup
---

# Finishing a Development Branch

## Overview

Guide completion of development work by presenting clear options and handling chosen workflow.

**Core principle:** Verify tests → Present options → Execute choice → Clean up.

**Announce at start:** "I'm using the finishing-a-development-branch skill to complete this work."

## Phase Status

**State Transition**: `executing` → `awaiting_user`

This skill transitions the phase from `executing` to `awaiting_user` when presenting options to the user. The user must make a choice (merge, PR, keep, or discard) before the workflow can proceed. Phase status is tracked via `.sisyphus/boulder.json`.

## The Process

### Step 1: 检测分支状态

**检查是否有多个 wave 分支：**

```bash
git branch --list "feature/*-wave*"
```

**如果有多个 wave 分支：**
→ 进入 Wave 合并流程（Step 1a）

**如果只有单个分支：**
→ 继续现有流程（Step 1b）

#### Step 1a: Wave 合并流程

1. **列出所有 wave 分支并排序：**
   ```bash
   git branch --list "feature/{name}-wave*" | sort -t'e' -k2 -n
   ```

2. **按 wave 编号顺序合并：**
   ```bash
   # 确保在主分支
   git checkout main
   
   # 逐个合并
   for wave in wave0 wave1 wave2 ...:
     git merge feature/{name}-wave{N} --no-ff -m "Merge wave {N}: {description}"
     
     # 检查冲突
     if [ $? -ne 0 ]; then
       echo "Conflict in wave {N}"
       echo "Please resolve conflicts, then run: git add . && git commit"
       # 暂停并等待用户解决
     fi
   done
   ```

3. **冲突处理：**
   - 显示冲突文件列表
   - 暂停并提示用户解决
   - 用户解决后继续下一个 wave

4. **合并完成后清理 wave 分支：**
   ```bash
   for wave in wave0 wave1 wave2 ...:
     git branch -d feature/{name}-wave{N}
   done
   ```

#### Step 1b: 单分支验证

**验证测试通过：**

```bash
# Run project's test suite
npm test / cargo test / pytest / go test ./...
```

**If tests fail:**
```
Tests failing (<N> failures). Must fix before completing:

[Show failures]

Cannot proceed with merge/PR until tests pass.
```

Stop. Don't proceed to Step 2.

**If tests pass:** Continue to Step 2.

### Step 2: Determine Base Branch

```bash
# Try common base branches
git merge-base HEAD main 2>/dev/null || git merge-base HEAD master 2>/dev/null
```

Or ask: "This branch split from main - is that correct?"

### Step 3: Present Options

Present exactly these 4 options:

```
Implementation complete. What would you like to do?

1. Merge locally - Merge to <base> and stay here
2. Create PR - Push branch and create pull request
3. Keep as-is - Leave branch for manual handling
4. Discard - Delete branch and all changes
```

Wait for user choice. Do not proceed without explicit selection.

### Step 4: Execute Choice

**Option 1 - Merge Locally:**
```bash
git checkout <base>
git merge <feature-branch>
git branch -d <feature-branch>
```

**Option 2 - Create PR:**
```bash
git push -u origin <feature-branch>
# Create PR via gh or API
```

**Option 3 - Keep As-Is:**
Just confirm and exit.

**Option 4 - Discard:**
```bash
Type 'discard' to confirm deletion of all work on this branch:
```
Then:
```bash
git checkout <base>
git branch -D <feature-branch>
```

### Step 5: Worktree Cleanup

**For Options 1 and 4:** Check if in worktree:
```bash
git worktree list | grep $(git branch --show-current)
```

If yes:
```bash
git worktree remove <worktree-path>
```

**For Option 3:** Keep worktree.

## Quick Reference

| Option | Merge | Push | Keep Worktree | Cleanup Branch |
|--------|-------|------|---------------|----------------|
| 1. Merge locally | ✓ | - | - | ✓ |
| 2. Create PR | - | ✓ | ✓ | - |
| 3. Keep as-is | - | - | ✓ | - |
| 4. Discard | - | - | - | ✓ (force) |

## Integration with Archive

**For Option 1 (Merge Locally):**
After successful merge, prompt:
```
Would you like to archive this change? Run /archive <change-name>
```

This triggers the archive workflow to save metadata and create Git tags.

## Red Flags

**Never:**
- Proceed with failing tests
- Merge without verifying tests on result
- Delete work without confirmation
- Force-push without explicit request

**Always:**
- Verify tests before offering options
- Present exactly 4 options
- Get typed confirmation for Option 4
- Clean up worktree for Options 1 & 4 only

## Integration

**Called by:**
- **subagent-driven-development** (Step 7) - After all tasks complete
- **executing-plans** (Step 5) - After all batches complete

**Pairs with:**
- **using-git-worktrees** - Cleans up worktree created by that skill

## 下一步

完成后：

**REQUIRED:** 运行 `/archive {change-name}` 归档变更

调用 `superpowers:archiving-changes` 完成归档流程。
