export type ContextMode = "review" | "research" | "development";

export interface ContextFile {
  path: string;
  weight: number;
}

export interface WeightConfig {
  test?: number;
  docs?: number;
  examples?: number;
  specs?: number;
  default?: number;
}

export class ContextSorter {
  private weights: Required<WeightConfig>;

  constructor(
    private mode: ContextMode,
    customWeights: WeightConfig = {}
  ) {
    this.weights = {
      test: customWeights.test ?? (mode === "review" ? 5 : 1),
      docs: customWeights.docs ?? (mode === "research" ? 5 : 1),
      examples: customWeights.examples ?? (mode === "research" ? 3 : 1),
      specs: customWeights.specs ?? (mode === "review" ? 3 : 1),
      default: customWeights.default ?? 1,
    };
  }

  public sort(files: ContextFile[]): ContextFile[] {
    const weightedFiles = files.map(file => ({
      ...file,
      weight: this.calculateWeight(file.path)
    }));

    return weightedFiles.sort((a, b) => b.weight - a.weight || a.path.localeCompare(b.path));
  }

  private calculateWeight(path: string): number {
    if (this.isTest(path)) return this.weights.test;
    if (this.isDoc(path)) return this.weights.docs;
    if (this.isExample(path)) return this.weights.examples;
    if (this.isSpec(path)) return this.weights.specs;
    return this.weights.default;
  }

  private isTest(path: string): boolean {
    return /\.test\.[tj]sx?$/.test(path) || /\.spec\.[tj]sx?$/.test(path) || path.includes("__tests__");
  }

  private isDoc(path: string): boolean {
    return /\.md$/.test(path) || /\.txt$/.test(path) || path.includes("docs/");
  }

  private isExample(path: boolean | string): path is string {
    if (typeof path !== "string") return false;
    return path.includes("examples/") || path.includes("samples/");
  }

  private isSpec(path: string): boolean {
    return /AGENTS\.md$|CONTRIBUTING\.md$|README\.md$/.test(path);
  }
}
