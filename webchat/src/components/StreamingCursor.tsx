/**
 * Animated logo cursor shown during streaming responses.
 * Center dot stays fixed; inner/outer rings rotate in opposite directions.
 */
export default function StreamingCursor() {
  return (
    <span className="streaming-cursor">
      <svg viewBox="0 0 144 144" xmlns="http://www.w3.org/2000/svg">
        <circle cx="72" cy="72" r="11" fill="currentColor" />
        <g className="ring-inner">
          <circle cx="72" cy="72" r="36" fill="none" stroke="currentColor" strokeWidth="10"
            strokeLinecap="round" strokeDasharray="188.5 37.7" transform="rotate(210 72 72)" />
        </g>
        <g className="ring-outer">
          <circle cx="72" cy="72" r="56" fill="none" stroke="currentColor" strokeWidth="10"
            strokeLinecap="round" strokeDasharray="274 77.9" transform="rotate(40 72 72)" />
        </g>
      </svg>
    </span>
  );
}
