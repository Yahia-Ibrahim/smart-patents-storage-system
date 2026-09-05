import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Skeleton,
  StatusBadge,
  Textarea,
} from '@/components/ui';
import { SearchIcon, SparkIcon } from '@/components/icons';
import { ApiClientError } from '@/services/apiClient';
import { patentService } from '@/services/patentService';
import type { SearchResult } from '@/types';
import { patentRef } from '@/utils/format';
import './Patents.css';

const MIN_LENGTH = 3;

/**
 * Semantic prior-art search.
 *
 * Not the same tool as the search box on the patents list, and the copy works
 * hard to say so: that one matches words in titles and abstracts, this one
 * matches *meaning* — you paste a description of an invention and it finds
 * filings about the same idea in different words, then has a model explain each
 * one. Users who think they are the same feature will conclude this one is
 * broken when it returns a patent with no words in common.
 *
 * Only approved patents are in the corpus, so a result here is always something
 * the reader can open and read in full.
 *
 * The whole feature depends on a service that can be down, and on model
 * credentials that may not be configured. Both arrive as a 503, and both are
 * shown as "unavailable, try later" rather than as an error in the page —
 * because nothing the user did was wrong, and nothing else in the app is
 * affected.
 */
export function PriorArtSearchPage() {
  const [text, setText] = useState('');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [searchedFor, setSearchedFor] = useState('');
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const trimmed = text.trim();
  const canSearch = trimmed.length >= MIN_LENGTH && !loading;

  const run = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSearch) return;

    setLoading(true);
    setError(null);
    setUnavailable(null);

    try {
      const found = await patentService.searchSemantic(trimmed);
      setResult(found);
      setSearchedFor(trimmed);
    } catch (err) {
      setResult(null);
      if (err instanceof ApiClientError && err.status === 503) setUnavailable(err.message);
      else if (err instanceof ApiClientError) setError(err.message);
      else setError('The search could not be completed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Discovery"
        title="Prior-art search"
        description="Describe an invention in your own words. This searches approved patents by meaning rather than by keyword, and explains why each result is related."
      />

      <Card>
        <form onSubmit={run} className="search__form">
          <Textarea
            rows={5}
            value={text}
            disabled={loading}
            maxLength={10000}
            aria-label="Describe the invention to search for"
            placeholder="e.g. A drink container that cools its own contents using a chemical reaction, with no power source or refrigeration."
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // A long passage is the intended input, so Enter must insert a
              // newline. Ctrl/Cmd-Enter is the deliberate submit.
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) run(e);
            }}
          />
          <div className="search__actions">
            <span className="search__hint">
              Pasting a full abstract works best. Press <kbd>Ctrl</kbd>+<kbd>Enter</kbd> to search.
            </span>
            <Button
              type="submit"
              leftIcon={<SearchIcon size={18} />}
              loading={loading}
              disabled={!canSearch}
            >
              Search prior art
            </Button>
          </div>
        </form>
      </Card>

      {unavailable && (
        <Alert tone="warning" title="Semantic search is unavailable">
          {unavailable} Everything else in the registry works normally — this feature depends on the
          AI service, which is separate.
        </Alert>
      )}

      {error && (
        <Alert tone="danger" title="The search failed">
          {error}
        </Alert>
      )}

      {loading && (
        <Card>
          <Skeleton width="70%" height={18} />
          <div className="search__skeleton">
            <Skeleton height={72} />
            <Skeleton height={72} />
            <Skeleton height={72} />
          </div>
        </Card>
      )}

      {!loading && result && (
        <>
          {result.summary && (
            <Card className="search__summary">
              <span className="search__summary-mark" aria-hidden="true">
                <SparkIcon size={18} />
              </span>
              <div>
                <h2 className="search__summary-title">What the search found</h2>
                <p className="search__summary-body">{result.summary}</p>
              </div>
            </Card>
          )}

          {result.results.length === 0 ? (
            <Card padding="none">
              <EmptyState
                icon={<SearchIcon size={26} />}
                title="No related patents found"
                description={
                  searchedFor
                    ? 'Nothing in the approved corpus resembles that description. Only approved filings are searchable — a related draft would not appear here.'
                    : undefined
                }
              />
            </Card>
          ) : (
            <ol className="search__results">
              {result.results.map(({ patent, explanation }, index) => (
                <li key={patent.id}>
                  <Card className="search__result">
                    <div className="search__result-head">
                      <span className="search__rank" aria-label={`Result ${index + 1}`}>
                        {index + 1}
                      </span>
                      <div className="search__result-identity">
                        <Link to={`/patents/${patent.id}`} className="search__result-title">
                          {patent.title}
                        </Link>
                        <span className="search__result-meta">
                          <span className="ref">{patentRef(patent.id)}</span>
                          <StatusBadge status={patent.status} />
                          {patent.jurisdiction && (
                            <span className="patents__muted">{patent.jurisdiction}</span>
                          )}
                        </span>
                      </div>
                    </div>

                    {explanation && (
                      <p className="search__why">
                        <span className="search__why-label">
                          <SparkIcon size={14} /> Why this matches
                        </span>
                        {explanation}
                      </p>
                    )}

                    <p className="search__abstract">{patent.abstract}</p>
                  </Card>
                </li>
              ))}
            </ol>
          )}
        </>
      )}

      {!loading && !result && !unavailable && !error && (
        <Card padding="none">
          <EmptyState
            icon={<SparkIcon size={26} />}
            title="Search by meaning, not by keyword"
            description="Two patents can describe the same invention without sharing a single word. Describe what the invention does and this will find those, with an explanation of how each one overlaps."
          />
        </Card>
      )}
    </>
  );
}
