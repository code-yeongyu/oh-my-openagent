export interface SlopConfig {
  commentThreshold: number;
  verboseLengthThreshold: number;
  repetitionThreshold: number;
  refreshInterval: number;
  guidelines: string;
}

export interface SlopDetectionResult {
  isSlop: boolean;
  reasons: string[];
  injectedGuidelines?: string;
}

export class SlopDetector {
  constructor(private config: SlopConfig) {}

  detect(content: string, round: number): SlopDetectionResult {
    const reasons: string[] = [];
    
    // Check for excessive comments
    if (this.detectExcessiveComments(content)) {
      reasons.push("excessive_comments");
    }

    // Check for verbose explanations
    if (this.detectVerboseExplanations(content)) {
      reasons.push("verbose_explanation");
    }

    // Check for repetitive code
    if (this.detectRepetitiveCode(content)) {
      reasons.push("repetitive_code");
    }

    const isSlop = reasons.length > 0;
    const shouldRefresh = round % this.config.refreshInterval === 0;

    let injectedGuidelines: string | undefined;
    if (isSlop || shouldRefresh) {
      injectedGuidelines = this.config.guidelines;
    }

    return {
      isSlop,
      reasons,
      injectedGuidelines
    };
  }

  private detectExcessiveComments(content: string): boolean {
    const lines = content.trim().split("\n").filter(l => l.trim().length > 0);
    if (lines.length === 0) return false;

    const commentLines = lines.filter(l => l.trim().startsWith("//") || l.trim().startsWith("/*") || l.trim().startsWith("*"));
    return commentLines.length / lines.length >= this.config.commentThreshold;
  }

  private detectVerboseExplanations(content: string): boolean {
    // Basic heuristic: look for text before first code block
    const codeBlockMatch = content.match(/```/);
    if (codeBlockMatch) {
      const precedingText = content.substring(0, codeBlockMatch.index).trim();
      return precedingText.length > this.config.verboseLengthThreshold;
    }
    
    // If no code block, check entire length
    return content.length > this.config.verboseLengthThreshold * 2;
  }

  private detectRepetitiveCode(content: string): boolean {
    const lines = content.trim().split("\n").map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length < 3) return false;

    const lineCounts = new Map<string, number>();
    for (const line of lines) {
      lineCounts.set(line, (lineCounts.get(line) || 0) + 1);
    }

    let repetitiveLineCount = 0;
    for (const count of lineCounts.values()) {
      if (count > 1) {
        repetitiveLineCount += count;
      }
    }

    return repetitiveLineCount / lines.length >= this.config.repetitionThreshold;
  }
}
