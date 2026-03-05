import { Suspense, lazy } from "react";

const Markdown = lazy(() => import("../../components/Markdown"));

export default function OcMarkdown({ content }: { content: string }) {
  return (
    <Suspense fallback={<pre className="oc-assistant-fallback">{content}</pre>}>
      <Markdown content={content} />
    </Suspense>
  );
}
