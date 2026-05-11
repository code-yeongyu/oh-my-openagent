export type TaskComplexity = "simple" | "complex" | "unknown"

interface PatternSet {
  patterns: RegExp[]
  weight: number
}

const SIMPLE_PATTERNS: PatternSet = {
  weight: 1,
  patterns: [
    // File listing and exploration
    /\b(list|show|display|print|give me|what's in)\b.*\b(file|files|folder|folders|directory|directories|dir|content|contents)\b/i,
    /\b(show|list|display)\b.*\b(all|the)\b.*\b(file|files|folder|folders|directory|directories)\b/i,

    // File reading
    /\b(read|view|show|print|display|give me|what is|what's)\b.*\b(content|contents|inside|text|code|source)\b/i,
    /\b(open|read|view)\b.*\b(file|script|module|document)\b/i,

    // README / docs updates
    /\b(update|edit|modify|change|fix|improve|add to)\b.*\b(readme|readme\.md|changelog|changelog\.md|doc|docs|documentation)\b/i,
    /\b(write|add|create|update)\b.*\b(doc|docs|documentation|readme|guide|example)\b/i,

    // Simple file creation
    /\b(create|write|make|generate)\b.*\b(simple|basic|quick|small|tiny)\b.*\b(file|script|function|test|component)\b/i,
    /\b(create|write|make)\b.*\b(file|script|module|component)\b.*\b(that|to|for)\b/i,

    // Simple edits
    /\b(fix|correct|update|change|edit|modify)\b.*\b(typo|spelling|grammar|import|comment|docstring|variable name|function name)\b/i,
    /\b(rename|move|delete|remove)\b.*\b(file|folder|directory|function|variable|class)\b/i,

    // Simple code additions
    /\b(add|insert|append|prepend)\b.*\b(comment|log|console\.log|import|test|assertion|check)\b/i,
    /\b(write|add|create)\b.*\b(test|spec|unit test|assertion)\b.*\b(for|to)\b/i,

    // Simple commands
    /\b(run|execute|call|invoke|test|lint|format|check)\b.*\b(command|script|test|suite|build|check)\b/i,

    // Simple queries
    /\b(how many|count|find|search for|grep for|locate)\b.*\b(file|files|line|lines|occurrence|match|reference|usage)\b/i,
    /\b(what|which|where|who|when|is there|are there|does|do)\b.*\b(file|files|folder|function|class|variable|test|config)\b/i,

    // Terminal-focused
    /\b(ls|cat|grep|find|pwd|cd|mkdir|touch|rm|cp|mv|echo|curl|wget)\b/i,
  ],
}

const COMPLEX_PATTERNS: PatternSet = {
  weight: -3,
  patterns: [
    // Architecture and design
    /\b(refactor|redesign|restructure|rewrite|rearchitect|overhaul|modernize)\b/i,
    /\b(architecture|architectural|design pattern|system design|data model|schema design)\b/i,
    /\b(migrate|migration|upgrade|port|transition|convert to|switch to)\b.*\b(framework|library|language|platform|version)\b/i,

    // Complex implementation
    /\b(implement|build|develop|create)\b.*\b(feature|system|service|api|module|engine|pipeline|workflow|integration)\b/i,
    /\b(add|introduce|integrate)\b.*\b(auth|authentication|authorization|security|encryption|payment|notification|cache|queue|database|orm)\b/i,

    // Debugging and investigation
    /\b(debug|investigate|troubleshoot|diagnose|figure out|find out|understand why|root cause)\b/i,
    /\b(fix|solve|resolve|address)\b.*\b(bug|issue|error|crash|memory leak|race condition|deadlock|performance|slow|bottleneck)\b/i,

    // Performance
    /\b(optimize|improve|enhance|tune|scale|benchmark|profile)\b.*\b(performance|speed|latency|throughput|memory|cpu|efficiency|scaling)\b/i,

    // Multi-file / cross-cutting
    /\b(across|throughout|all over|in every|multiple|many|several|all)\b.*\b(file|files|module|modules|component|components|test|tests)\b/i,
    /\b(update|change|modify|refactor)\b.*\b(all|every|each|multiple|many)\b.*\b(file|files|test|tests|call|calls|reference|references)\b/i,

    // Complex algorithms
    /\b(algorithm|data structure|complexity|big o|recursive|concurrent|parallel|distributed|async|sync|thread|lock|mutex)\b/i,
    /\b(implement|write|design)\b.*\b(sort|search|graph|tree|hash|cache|index|parser|interpreter|compiler|validator|serializer)\b/i,

    // Testing infrastructure
    /\b(set up|setup|configure|build)\b.*\b(ci\/cd|pipeline|testing|test suite|coverage|mock|stub|fixture|infrastructure|devops)\b/i,
  ],
}

export function classifyTaskComplexity(text: string): TaskComplexity {
  const normalized = text.trim().toLowerCase()
  if (normalized.length === 0) return "unknown"

  let score = 0

  for (const pattern of SIMPLE_PATTERNS.patterns) {
    if (pattern.test(normalized)) {
      score += SIMPLE_PATTERNS.weight
    }
  }

  for (const pattern of COMPLEX_PATTERNS.patterns) {
    if (pattern.test(normalized)) {
      score += COMPLEX_PATTERNS.weight
    }
  }

  // Strong negative signals override everything
  const hasStrongComplexSignal = COMPLEX_PATTERNS.patterns.slice(0, 5).some((p) => p.test(normalized))
  if (hasStrongComplexSignal && score <= 0) {
    return "complex"
  }

  if (score >= 1) return "simple"
  if (score < 0) return "complex"
  return "unknown"
}
