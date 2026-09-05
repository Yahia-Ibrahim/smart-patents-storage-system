import { describe, expect, it } from 'vitest';
import { fileSize, patentRef, similarityPercent, similarityTone } from '../format';

describe('patentRef', () => {
  it('pads a short id to the registry reference format', () => {
    expect(patentRef('42')).toBe('PAT-000042');
  });

  it('leaves an id longer than the padding intact', () => {
    expect(patentRef('12345678')).toBe('PAT-12345678');
  });
});

describe('similarityPercent', () => {
  /** Scores arrive as 0..1 cosine values everywhere except the review row. */
  it('renders a cosine score as a percentage', () => {
    expect(similarityPercent(0.763)).toBe('76.3%');
    expect(similarityPercent(0.0808)).toBe('8.1%');
    expect(similarityPercent(1)).toBe('100.0%');
  });
});

describe('similarityTone', () => {
  /**
   * Presentation only — nothing branches on these, because the AI gates
   * nothing. They exist so a reviewer can tell 0.76 from 0.08 at a glance.
   */
  it('bands scores from strong to unremarkable', () => {
    expect(similarityTone(0.9)).toBe('danger');
    expect(similarityTone(0.75)).toBe('danger');
    expect(similarityTone(0.6)).toBe('warning');
    expect(similarityTone(0.45)).toBe('warning');
    expect(similarityTone(0.44)).toBe('neutral');
    expect(similarityTone(0)).toBe('neutral');
  });
});

describe('fileSize', () => {
  it('scales the unit to the size', () => {
    expect(fileSize(74)).toBe('74 B');
    expect(fileSize(2048)).toBe('2 KB');
    expect(fileSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
