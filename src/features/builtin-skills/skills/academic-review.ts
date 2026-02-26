import type { BuiltinSkill } from "../types"

export const ACADEMIC_REVIEW_SKILL_NAME = "academic-review"

export const ACADEMIC_REVIEW_SKILL_DESCRIPTION =
  "Academic paper review expertise: IMRaD analysis, review criteria, common weakness detection, structured review output, major vs minor revisions, conference vs journal conventions, and constructive feedback guidelines. Triggers: 'paper review', 'manuscript', 'peer review', 'academic review', 'journal submission'."

export const academicReviewSkill: BuiltinSkill = {
  name: ACADEMIC_REVIEW_SKILL_NAME,
  description: ACADEMIC_REVIEW_SKILL_DESCRIPTION,
  template: `# Academic Paper Review — Expert Reference

## MANUSCRIPT STRUCTURE (IMRaD)

### Expected Sections
| Section | Purpose | What to Evaluate |
|---------|---------|-----------------|
| **Title** | Concise summary of contribution | Accuracy, specificity, no clickbait |
| **Abstract** | Self-contained summary (150-300 words) | Problem, method, key results, significance |
| **Introduction** | Motivation, gap, contribution, outline | Clear problem statement, research gap, explicit contributions list |
| **Related Work** | Positioning in literature | Comprehensive coverage, fair comparison, clear differentiation |
| **Methodology** | How the work was done | Reproducibility, justification of choices, formal rigor |
| **Experiments / Evaluation** | Evidence for claims | Baselines, metrics, statistical significance, ablations |
| **Results & Discussion** | Interpretation of findings | Honest assessment, limitations acknowledged, implications |
| **Conclusion** | Summary + future work | No new claims, concrete future directions |
| **References** | Supporting evidence | Sufficient, recent, relevant, properly formatted |

## REVIEW CRITERIA

### Core Dimensions

| Dimension | Key Questions |
|-----------|--------------|
| **Novelty** | Is this truly new? Does it advance the state of the art? Is the delta significant? |
| **Significance** | Does this matter? Would the community benefit? Is the problem important? |
| **Soundness** | Are the claims supported? Is the methodology correct? Are there logical gaps? |
| **Clarity** | Is it well-written? Can a competent reader follow the argument? Are figures informative? |
| **Reproducibility** | Could someone replicate this? Are details sufficient? Is code/data available? |
| **Completeness** | Are all necessary experiments done? Missing ablations? Missing comparisons? |

### Journal vs Conference Conventions

| Aspect | Journal | Conference |
|--------|---------|-----------|
| **Length** | 15-30+ pages, comprehensive | 8-14 pages, focused |
| **Review rounds** | Multiple (R1, R2, R3) | Single round (usually) |
| **Revision types** | Minor revision, Major revision, Reject & resubmit | Accept, Weak Accept, Borderline, Weak Reject, Reject |
| **Expected depth** | Exhaustive experiments, thorough related work | Key results, strong motivation |
| **Timeline** | Months to years | Weeks to months |
| **Novelty bar** | Incremental advances acceptable if thorough | Higher novelty bar, less tolerance for incremental |

## COMMON WEAKNESSES — DETECTION GUIDE

### Methodology Issues
| Weakness | Signal | Severity |
|----------|--------|----------|
| **Missing baselines** | No comparison to established methods | Major |
| **Unfair comparison** | Different hyperparameters, datasets, or compute budgets | Major |
| **Cherry-picked results** | Only best runs reported, no variance/std-dev | Major |
| **No ablation study** | Cannot tell which component contributes | Major |
| **Circular reasoning** | Method validated on data it was designed for | Critical |
| **Dataset bias** | Training/test overlap, selection bias, small sample | Major |
| **No statistical tests** | Claims of improvement without significance testing | Moderate |

### Writing Issues
| Weakness | Signal | Severity |
|----------|--------|----------|
| **Overclaimed contributions** | "First ever", "novel" without substantiation | Moderate |
| **Vague problem statement** | Cannot identify specific research question | Major |
| **Missing limitations** | No discussion of when method fails | Moderate |
| **Figure quality** | Low resolution, missing labels, unreadable | Minor |
| **Notation inconsistency** | Same symbol means different things | Minor |
| **Self-plagiarism** | Large verbatim blocks from authors' prior work | Moderate |

### Structural Issues
| Weakness | Signal | Severity |
|----------|--------|----------|
| **Introduction too long** | More than 2 pages, rambling motivation | Minor |
| **Related work as laundry list** | No synthesis or positioning | Moderate |
| **Results without discussion** | Numbers presented but not interpreted | Major |
| **Conclusion introduces new claims** | Claims not supported earlier | Major |

## REVIEW OUTPUT FORMAT

### Structured Review Template

\`\`\`
## Summary
[2-3 sentences: what the paper does, the approach, key results]

## Strengths
1. [Strength with brief justification]
2. [...]
3. [...]

## Weaknesses
1. [Weakness]: [Why it matters]. [Suggestion to address]
2. [...]
3. [...]

## Questions for Authors
1. [Specific question about methodology/results]
2. [...]

## Minor Comments
- Page X, Line Y: [specific editorial comment]
- [...]

## Overall Assessment
**Recommendation**: [Accept / Minor Revision / Major Revision / Reject]
**Confidence**: [High / Medium / Low]
**Justification**: [2-3 sentences explaining the recommendation]
\`\`\`

## TONE GUIDELINES

### DO
- Be specific: "Section 3.2 lacks comparison to [Method X]" not "needs more baselines"
- Be constructive: "Consider adding [specific experiment] to strengthen claim Y"
- Acknowledge effort: "The authors present an interesting approach to..."
- Separate major from minor: Clearly distinguish critical issues from polish items
- Be honest about uncertainty: "I am not an expert in [area], but [concern]"

### DO NOT
- Use dismissive language: "trivial", "obvious", "anyone would know"
- Make personal attacks: Focus on the work, not the authors
- Demand your preferred approach: Suggest alternatives, don't mandate them
- Reject solely on writing quality: If ideas are sound, recommend revision
- Use sarcasm or rhetorical questions as criticism

## SCORING RUBRICS

### Typical Conference Scale (e.g., NeurIPS, ICML, ACL)
| Score | Label | Meaning |
|-------|-------|---------|
| 8-10 | Strong Accept | Top-tier, significant advance, clear and well-executed |
| 6-7 | Weak Accept | Solid work, some issues but above threshold |
| 5 | Borderline | Mixed — could go either way, needs discussion |
| 3-4 | Weak Reject | Below threshold, significant issues |
| 1-2 | Strong Reject | Fundamental flaws, not suitable for venue |

### Journal Decision Types
| Decision | Meaning | Next Steps |
|----------|---------|-----------|
| **Accept** | Ready for publication as-is or with copyediting | Rare on first submission |
| **Minor Revision** | Small fixes needed, no re-review required | Authors respond to comments, editor decides |
| **Major Revision** | Significant issues, re-review needed | Authors revise extensively, reviewers re-evaluate |
| **Reject & Resubmit** | Fundamental issues, but core idea has merit | Authors can resubmit as new submission |
| **Reject** | Not suitable for this venue | Authors should consider alternative venues |`,
}
