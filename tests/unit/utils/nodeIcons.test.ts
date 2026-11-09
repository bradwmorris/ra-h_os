import { describe, expect, it } from 'vitest';
import { BookOpen, History } from 'lucide-react';
import { typeIcon } from '@/utils/nodeIcons';

describe('typeIcon', () => {
  it('maps known metadata types, normalising case and underscores', () => {
    expect(typeIcon('reference')).toBe(BookOpen);
    expect(typeIcon(' Project_History ')).toBe(History);
  });

  it('returns null for unknown, non-string and inherited object keys', () => {
    expect(typeIcon('not-a-type')).toBeNull();
    expect(typeIcon(42)).toBeNull();
    expect(typeIcon(undefined)).toBeNull();
    expect(typeIcon('constructor')).toBeNull();
    expect(typeIcon('__proto__')).toBeNull();
    expect(typeIcon('toString')).toBeNull();
  });
});
