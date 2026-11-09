import { describe, expect, it } from 'vitest';
import { detectCommunities, UNLINKED } from '@/components/panes/map/communities';

function clique(prefix: string, size: number): Array<[string, string]> {
  const edges: Array<[string, string]> = [];
  for (let i = 0; i < size; i += 1) {
    for (let j = i + 1; j < size; j += 1) edges.push([`${prefix}${i}`, `${prefix}${j}`]);
  }
  return edges;
}

function ids(prefix: string, size: number): string[] {
  return Array.from({ length: size }, (_v, i) => `${prefix}${i}`);
}

describe('detectCommunities', () => {
  it('separates two dense groups joined by a single bridge', () => {
    const nodes = [...ids('a', 5), ...ids('b', 5)];
    const edges = [...clique('a', 5), ...clique('b', 5), ['a0', 'b0'] as [string, string]];

    const { membership, communities } = detectCommunities(nodes, edges);

    expect(communities).toHaveLength(2);
    const aGroup = membership.get('a0');
    const bGroup = membership.get('b0');
    expect(aGroup).not.toBe(bGroup);
    ids('a', 5).forEach((id) => expect(membership.get(id)).toBe(aGroup));
    ids('b', 5).forEach((id) => expect(membership.get(id)).toBe(bGroup));
  });

  it('orders communities largest first and puts isolated nodes in UNLINKED', () => {
    const nodes = [...ids('big', 6), ...ids('small', 3), 'lonely1', 'lonely2'];
    const edges = [...clique('big', 6), ...clique('small', 3)];

    const { membership, communities, unlinked } = detectCommunities(nodes, edges);

    expect(communities.map((c) => c.length)).toEqual([6, 3]);
    expect(membership.get('big0')).toBe(0);
    expect(membership.get('small0')).toBe(1);
    expect(unlinked).toEqual(['lonely1', 'lonely2']);
    expect(membership.get('lonely1')).toBe(UNLINKED);
  });

  it('is deterministic regardless of edge order and ignores duplicates, self-loops and unknown ids', () => {
    const nodes = [...ids('a', 4), ...ids('b', 4)];
    const base = [...clique('a', 4), ...clique('b', 4), ['a3', 'b3'] as [string, string]];
    const noisy: Array<[string, string]> = [
      ...[...base].reverse(),
      ['a0', 'a1'],
      ['b2', 'b2'],
      ['a0', 'ghost'],
    ];

    const first = detectCommunities(nodes, base);
    const second = detectCommunities([...nodes].reverse(), noisy);

    expect([...second.membership.entries()].sort()).toEqual([...first.membership.entries()].sort());
  });

  it('assigns every input node exactly once', () => {
    const nodes = [...ids('x', 12), 'solo'];
    const edges: Array<[string, string]> = [];
    for (let i = 0; i < 11; i += 1) edges.push([`x${i}`, `x${i + 1}`]); // a path

    const { membership, communities, unlinked } = detectCommunities(nodes, edges);

    expect(membership.size).toBe(nodes.length);
    const covered = communities.flat().length + unlinked.length;
    expect(covered).toBe(nodes.length);
    // A long path splits into more than one community.
    expect(communities.length).toBeGreaterThan(1);
  });

  it('handles an empty graph', () => {
    const result = detectCommunities([], []);
    expect(result.communities).toEqual([]);
    expect(result.unlinked).toEqual([]);
  });
});
