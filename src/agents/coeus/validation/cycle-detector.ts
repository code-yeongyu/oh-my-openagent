const enum Color {
  White = 0,
  Gray = 1,
  Black = 2,
}

export function detectCycles(
  graph: Record<string, string[]>
): string[][] {
  const nodes = Object.keys(graph);
  if (nodes.length === 0) return [];

  const color = new Map<string, Color>();
  const parent = new Map<string, string | null>();
  const cycles: string[][] = [];
  const cycleSet = new Set<string>();

  for (const node of nodes) {
    color.set(node, Color.White);
  }

  function dfs(node: string): void {
    color.set(node, Color.Gray);

    const neighbors = graph[node] ?? [];
    for (const neighbor of neighbors) {
      const neighborColor = color.get(neighbor);

      if (neighborColor === Color.Gray) {
        const cycle = extractCycle(node, neighbor);
        const key = [...cycle].sort().join(",");
        if (!cycleSet.has(key)) {
          cycleSet.add(key);
          cycles.push(cycle);
        }
      } else if (neighborColor === undefined || neighborColor === Color.White) {
        parent.set(neighbor, node);
        if (neighborColor === undefined) {
          color.set(neighbor, Color.White);
        }
        dfs(neighbor);
      }
    }

    color.set(node, Color.Black);
  }

  function extractCycle(from: string, to: string): string[] {
    if (from === to) return [from];

    const cycle: string[] = [to];
    let current: string | null | undefined = from;

    while (current !== null && current !== undefined && current !== to) {
      cycle.push(current);
      current = parent.get(current);
    }

    return cycle.reverse();
  }

  for (const node of nodes) {
    if (color.get(node) === Color.White) {
      parent.set(node, null);
      dfs(node);
    }
  }

  return cycles;
}
