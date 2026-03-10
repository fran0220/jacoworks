import Markdown from "./Markdown";

/**
 * Streaming Markdown renderer.
 *
 * Previously used a two-phase strategy (raw <pre> + debounced marked.parse).
 * Now simply delegates to <Markdown> which uses react-markdown — its React
 * component tree output benefits from virtual DOM diffing, so incremental
 * tokens only trigger末尾 node updates rather than full DOM replacement.
 */
export default function StreamingMarkdown({
  content,
  workspacePath,
}: {
  content: string;
  workspacePath?: string;
}) {
  return <Markdown content={content} workspacePath={workspacePath} />;
}
