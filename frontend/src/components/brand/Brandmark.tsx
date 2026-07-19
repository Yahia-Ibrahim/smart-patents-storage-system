import './Brandmark.css';

export interface BrandmarkProps {
  /** Icon-only mark, or mark + wordmark. */
  showWordmark?: boolean;
  size?: number;
  /** Render for a dark surface (the sidebar/auth panel). */
  onDark?: boolean;
}

/**
 * The certification-seal mark — the app's signature motif. A precise concentric
 * seal with a registered "P" at its centre, echoing the impression stamped on
 * an official grant. Drawn, not decorative: the double ring + tick marks read
 * as a notary seal.
 */
export function Brandmark({ showWordmark = true, size = 30, onDark = false }: BrandmarkProps) {
  return (
    <span className={`brandmark ${onDark ? 'brandmark--dark' : ''}`}>
      <svg
        className="brandmark__seal"
        width={size}
        height={size}
        viewBox="0 0 40 40"
        fill="none"
        aria-hidden="true"
      >
        <circle cx="20" cy="20" r="18.5" stroke="currentColor" strokeWidth="1.3" opacity="0.4" />
        <circle cx="20" cy="20" r="14.5" stroke="currentColor" strokeWidth="1.6" />
        {/* seal tick marks around the ring */}
        <g stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity="0.5">
          <path d="M20 1.5v3M20 35.5v3M38.5 20h-3M4.5 20h-3M33 7l-2 2M9 31l-2 2M33 33l-2-2M9 9 7 7" />
        </g>
        <path
          d="M15 27V13h6.2c2.9 0 4.8 1.9 4.8 4.6s-1.9 4.6-4.8 4.6H18.2V27H15Zm3.2-7.4h2.6c1.2 0 2-.8 2-2s-.8-2-2-2h-2.6v4Z"
          fill="currentColor"
        />
      </svg>
      {showWordmark && (
        <span className="brandmark__wordmark">
          <span className="brandmark__name">Smart Patents</span>
          <span className="brandmark__tag">IP Registry</span>
        </span>
      )}
    </span>
  );
}
