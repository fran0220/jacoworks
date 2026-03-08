import { Suspense, lazy, useEffect, useRef, useState } from "react";

const Markdown = lazy(() => import("./Markdown"));

/**
 * During active streaming, render raw text immediately for character-by-character feel.
 * Debounce the heavy Markdown parsing so it catches up during pauses.
 */
const MARKDOWN_DEBOUNCE_MS = 300;

export default function StreamingMarkdown({ content }: { content: string }) {
  const [parsedContent, setParsedContent] = useState(content);
  const timerRef = useRef<number | null>(null);
  const isSyncedRef = useRef(true);

  useEffect(() => {
    // Clear any pending Markdown parse timer
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }

    isSyncedRef.current = false;

    // Schedule a debounced Markdown re-parse
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      isSyncedRef.current = true;
      setParsedContent(content);
    }, MARKDOWN_DEBOUNCE_MS);

    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [content]);

  // If Markdown is still catching up, show raw text instantly (no delay)
  if (!isSyncedRef.current && content !== parsedContent) {
    return <pre className="streaming-text">{content}</pre>;
  }

  return (
    <Suspense fallback={<pre className="streaming-text">{content}</pre>}>
      <Markdown content={parsedContent} />
    </Suspense>
  );
}
