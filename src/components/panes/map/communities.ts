/**
 * Deterministic Louvain community detection for small undirected graphs.
 *
 * Groups nodes so that links are dense inside a group and sparse between groups
 * (modularity maximisation). Nodes are visited in ascending id order and ties are
 * broken by the lowest community id, so the same graph always yields the same groups,
 * which keeps the map layout stable between renders.
 *
 * Pure data in, data out: no DOM, React or graph-library imports.
 */

export interface CommunityResult {
  /** Community index per node id. 0 is the largest community. Unlinked nodes map to UNLINKED. */
  membership: Map<string, number>;
  /** Members of each community, indexed like `membership`; each list is sorted. */
  communities: string[][];
  /** Nodes with no links to any other node in the input. */
  unlinked: string[];
}

export const UNLINKED = -1;

interface WeightedGraph {
  size: number;
  /** adjacency[i] maps neighbour index -> edge weight (self-loops allowed after aggregation). */
  adjacency: Array<Map<number, number>>;
  totalWeight: number;
}

function buildGraph(size: number, edges: Array<[number, number, number]>): WeightedGraph {
  const adjacency = Array.from({ length: size }, () => new Map<number, number>());
  let totalWeight = 0;
  for (const [a, b, w] of edges) {
    adjacency[a].set(b, (adjacency[a].get(b) ?? 0) + w);
    if (a !== b) adjacency[b].set(a, (adjacency[b].get(a) ?? 0) + w);
    totalWeight += w;
  }
  return { size, adjacency, totalWeight };
}

function degreeOf(graph: WeightedGraph, node: number): number {
  let degree = 0;
  graph.adjacency[node].forEach((w, neighbour) => {
    degree += neighbour === node ? 2 * w : w;
  });
  return degree;
}

/** One level of Louvain local moving. Returns community per node, relabelled 0..k-1. */
function localMoving(graph: WeightedGraph, resolution: number): { assignment: number[]; moved: boolean } {
  const { size, adjacency, totalWeight } = graph;
  const assignment = Array.from({ length: size }, (_v, i) => i);
  if (totalWeight === 0) return { assignment, moved: false };

  const m2 = 2 * totalWeight;
  const degrees = Array.from({ length: size }, (_v, i) => degreeOf(graph, i));
  const communityTotal = [...degrees];
  let movedAny = false;

  for (let pass = 0; pass < 100; pass += 1) {
    let movedThisPass = false;
    for (let node = 0; node < size; node += 1) {
      const current = assignment[node];
      const nodeDegree = degrees[node];

      const linksTo = new Map<number, number>();
      adjacency[node].forEach((w, neighbour) => {
        if (neighbour === node) return;
        const community = assignment[neighbour];
        linksTo.set(community, (linksTo.get(community) ?? 0) + w);
      });

      communityTotal[current] -= nodeDegree;
      let best = current;
      let bestGain = (linksTo.get(current) ?? 0) - (resolution * communityTotal[current] * nodeDegree) / m2;
      const candidates = [...linksTo.keys()].sort((a, b) => a - b);
      for (const community of candidates) {
        const gain = (linksTo.get(community) ?? 0) - (resolution * communityTotal[community] * nodeDegree) / m2;
        if (gain > bestGain + 1e-12 || (Math.abs(gain - bestGain) <= 1e-12 && community < best)) {
          best = community;
          bestGain = gain;
        }
      }
      communityTotal[best] += nodeDegree;
      if (best !== current) {
        assignment[node] = best;
        movedThisPass = true;
        movedAny = true;
      }
    }
    if (!movedThisPass) break;
  }

  const relabel = new Map<number, number>();
  const relabelled = assignment.map((community) => {
    if (!relabel.has(community)) relabel.set(community, relabel.size);
    return relabel.get(community) as number;
  });
  return { assignment: relabelled, moved: movedAny };
}

function aggregate(graph: WeightedGraph, assignment: number[]): WeightedGraph {
  const count = Math.max(...assignment) + 1;
  const edges: Array<[number, number, number]> = [];
  graph.adjacency.forEach((neighbours, node) => {
    neighbours.forEach((w, neighbour) => {
      if (neighbour < node) return; // count each undirected edge once
      edges.push([assignment[node], assignment[neighbour], w]);
    });
  });
  return buildGraph(count, edges);
}

/**
 * Detect communities. `edges` may contain duplicates, self-loops and ids missing from
 * `nodeIds` (ignored). `resolution` above 1 favours more, smaller communities.
 */
export function detectCommunities(
  nodeIds: string[],
  edges: Array<[string, string]>,
  resolution = 1,
): CommunityResult {
  const ids = [...new Set(nodeIds)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const index = new Map(ids.map((id, i) => [id, i]));

  const seenPairs = new Set<string>();
  const indexEdges: Array<[number, number, number]> = [];
  for (const [source, target] of edges) {
    const a = index.get(source);
    const b = index.get(target);
    if (a === undefined || b === undefined || a === b) continue;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    indexEdges.push([a, b, 1]);
  }

  let graph = buildGraph(ids.length, indexEdges);
  // node index -> community, refined level by level
  let membershipByIndex = ids.map((_id, i) => i);

  for (let level = 0; level < 20; level += 1) {
    const { assignment, moved } = localMoving(graph, resolution);
    membershipByIndex = membershipByIndex.map((community) => assignment[community]);
    if (!moved) break;
    graph = aggregate(graph, assignment);
  }

  const linked = new Set<number>();
  for (const [a, b] of indexEdges) {
    linked.add(a);
    linked.add(b);
  }

  const groups = new Map<number, string[]>();
  const unlinked: string[] = [];
  ids.forEach((id, i) => {
    if (!linked.has(i)) {
      unlinked.push(id);
      return;
    }
    const community = membershipByIndex[i];
    const members = groups.get(community) ?? [];
    members.push(id);
    groups.set(community, members);
  });

  // Largest community first; ties broken by the lowest member id for stability.
  const communities = [...groups.values()].sort((a, b) => b.length - a.length || a[0].localeCompare(b[0], undefined, { numeric: true }));
  const membership = new Map<string, number>();
  communities.forEach((members, communityIndex) => members.forEach((id) => membership.set(id, communityIndex)));
  unlinked.forEach((id) => membership.set(id, UNLINKED));

  return { membership, communities, unlinked };
}
