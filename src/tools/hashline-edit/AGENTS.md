# src/tools/hashline-edit/ — 哈希锚点的文件编辑工具

**生成时间:** 2026-05-15

## 概述

24 个文件。实现 `hashline_edit` 工具 — 哈希锚点的文件编辑，每个行引用都包含内容哈希（`LINE#ID`）。在应用编辑前验证哈希，拒绝过时的引用。

## 三操作模型

所有编辑精确使用 3 种操作：

| 操作 | pos | end | lines | 效果 |
|----|-----|-----|-------|--------|
| `replace` | 必需 | 可选 | 必需 | 替换单行或 pos..end 范围 |
| `append` | 可选 | 可选 | 必需 | 在锚点后插入（若无锚点则在 EOF 处）|
| `prepend` | 可选 | 可选 | 必需 | 在锚点前插入（若无锚点则在 BOF 处）|

`lines: null` 或 `lines: []` 结合 `replace` = 删除。工具级别 `delete: true` = 删除文件。

## 执行管道

```
hashline-edit-executor.ts
  → normalize-edits.ts       # 解析 RawHashlineEdit → HashlineEdit（验证操作 schema）
  → validation.ts            # 验证 LINE#ID 引用（哈希匹配、行存在）
  → edit-ordering.ts         # 从下到上排序（按行号降序）
  → edit-deduplication.ts    # 移除重复操作
  → edit-operations.ts       # 使用 edit-operation-primitives.ts 应用每个操作
  → autocorrect-replacement-lines.ts  # 自动修复缩进/格式
  → hashline-edit-diff.ts    # 使用 diff-utils.ts 构建差异输出
```

## 关键文件

| 文件 | 用途 |
|------|---------|
| `tools.ts` | `createHashlineEditTool()` 工厂 — 工具 schema + 入口点 |
| `hashline-edit-executor.ts` | 主要执行：标准化 → 验证 → 排序 → 应用 → 差异输出 |
| `normalize-edits.ts` | 解析 `RawHashlineEdit[]`（允许字符串 `op` 变体）→ 类型化 `HashlineEdit[]` |
| `validation.ts` | 验证 LINE#ID：解析哈希，验证行内容与存储的哈希匹配 |
| `hash-computation.ts` | `computeLineHash(line)` → 来自集合 `ZPMQVRWSNKTXJBYH` 的 2 字符 CID |
| `edit-operations.ts` | 将 replace/append/prepend 应用到文件行数组 |
| `edit-operation-primitives.ts` | 底层行数组变异原语 |
| `edit-ordering.ts` | 从下到上排序编辑，以在多次编辑期间保留行号 |
| `edit-deduplication.ts` | 对重叠/相同操作去重 |
| `edit-text-normalization.ts` | 标准化行内容（CRLF、BOM、尾随空白）|
| `file-text-canonicalization.ts` | 在哈希前规范化完整文件内容 |
| `autocorrect-replacement-lines.ts` | 从原始行自动恢复缩进 |
| `hashline-edit-diff.ts` | 为错误/成功消息生成统一差异格式 |
| `diff-utils.ts` | `diff` npm 库的薄包装器 |
| `hashline-chunk-formatter.ts` | 使用 `LINE#ID` tags |
| `tool-description.ts` | `HASHLINE_EDIT_DESCRIPTION` constant |
| `types.ts` | `HashlineEdit`, `ReplaceEdit`, `AppendEdit`, `PrependEdit` |
| `constants.ts` | Hash alphabet, separator character (`#`), pipe separator (`|`) |

## LINE#ID FORMAT

```
{line_number}#{hash_id}
```

- `hash_id`: two chars from `ZPMQVRWSNKTXJBYH` (CID letters)
- Example: `42#VK` means line 42 with hash `VK`
- Validation: recompute hash of current line content → must match stored hash
- Content separator: `|` (pipe) between hash tag and content in read output

## AUTOCORRECT BEHAVIORS (built-in)

- Merged lines auto-expanded back to original count
- Indentation restored from original lines
- BOM and CRLF line endings preserved
- `>>>` prefix and diff markers in `lines` text auto-stripped

## ERROR CASES

- Hash mismatch → edit rejected, diff shown with current state
- Overlapping ranges → detected and rejected
- Missing `pos` for `replace` → schema error
- `lines: null` with `append`/`prepend` → schema error

## HOW LINE HASHES WORK

```typescript
// Reading: every line gets tagged
"42#VK| function hello() {"

// Editing: reference by tag
{ op: "replace", pos: "42#VK", lines: "function hello(name: string) {" }

// If file changed since read: hash won't match → rejected before corruption
```
