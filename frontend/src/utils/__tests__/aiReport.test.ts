import { describe, expect, it } from 'vitest';
import { parseAiReport } from '../aiReport';
import type { PatentReview } from '@/types';

/**
 * `parseAiReport` reads JSON produced by another team's service, stored in a
 * free-text column shared with human review comments. Both of those make it the
 * one place in the frontend where malformed input is expected rather than
 * exceptional — a throw here blanks the examination tab of a real filing.
 */
const review = (overrides: Partial<PatentReview> = {}): Pick<PatentReview, 'stage' | 'comments'> => ({
  stage: 'ai_filter',
  comments: JSON.stringify({
    source: 'ai-similarity',
    matchCount: 2,
    matches: [
      { patentId: '11', title: 'Self-chilling can', score: 0.763 },
      { patentId: '7', title: 'Wind turbine controller', score: 0.0808 },
    ],
  }),
  ...overrides,
});

describe('parseAiReport', () => {
  it('reads a well-formed report', () => {
    const report = parseAiReport(review());

    expect(report).not.toBeNull();
    expect(report!.matchCount).toBe(2);
    expect(report!.matches.map((m) => m.patentId)).toEqual(['11', '7']);
    expect(report!.matches[0].score).toBeCloseTo(0.763);
  });

  /**
   * A human decision's comments are prose in the same column. Mapping over
   * every review hands them to this function, so "not JSON" is an ordinary
   * outcome and must not look like a broken report.
   */
  it('ignores a human review', () => {
    expect(
      parseAiReport({ stage: 'admin_review', comments: 'Declined: claims are not distinguished.' }),
    ).toBeNull();
  });

  it('returns null when there are no comments at all', () => {
    expect(parseAiReport({ stage: 'ai_filter', comments: null })).toBeNull();
  });

  it.each([
    ['invalid json', '{not json'],
    ['a bare string', '"hello"'],
    ['a number', '42'],
    ['null', 'null'],
  ])('returns null for %s', (_label, comments) => {
    expect(parseAiReport({ stage: 'ai_filter', comments })).toBeNull();
  });

  it('survives a report with no matches array', () => {
    const report = parseAiReport({ stage: 'ai_filter', comments: '{"matchCount":0}' });

    expect(report).toEqual({ matchCount: 0, matches: [] });
  });

  /**
   * A partially bad payload should cost only the bad entries. Dropping the
   * whole report because one match is malformed would hide the findings that
   * are fine.
   */
  it('drops unusable matches and keeps the rest', () => {
    const report = parseAiReport({
      stage: 'ai_filter',
      comments: JSON.stringify({
        matches: [
          { patentId: '11', title: 'Good', score: 0.9 },
          { patentId: 12, title: 'Numeric id', score: 0.8 },
          { patentId: '13', title: 'No score' },
          { patentId: '14', score: 0.5 },
        ],
      }),
    });

    expect(report!.matches.map((m) => m.patentId)).toEqual(['11', '14']);
    // A match with no title is still a real finding; it just needs a label.
    expect(report!.matches[1].title).toBe('Untitled');
  });

  /** matchCount comes from the payload, but must not be trusted blindly. */
  it('falls back to counting when matchCount is absent or wrong', () => {
    const report = parseAiReport({
      stage: 'ai_filter',
      comments: JSON.stringify({ matches: [{ patentId: '1', title: 'x', score: 0.1 }] }),
    });

    expect(report!.matchCount).toBe(1);
  });
});
