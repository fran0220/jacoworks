import { useRef, useState } from "react";
import { Brain, ChevronDown, ChevronRight } from "lucide-react";
import { usePretextFont, calcTextHeight } from "../hooks/usePretext";

const PADDING_V = 16; // 0.5rem * 2
const MAX_H = 200;
const FALLBACK_H = 200;

export default function ThinkingBlock({ content, streaming }: { content: string; streaming?: boolean }) {
  const [open, setOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const fontInfo = usePretextFont(contentRef);

  let targetHeight = FALLBACK_H;
  if (fontInfo.ready && content && contentRef.current) {
    const w = contentRef.current.clientWidth - 24; // 0.75rem * 2 horizontal padding
    const { height } = calcTextHeight(content, fontInfo.font, fontInfo.lineHeight, w > 0 ? w : 300, "pre-wrap");
    targetHeight = Math.min(Math.ceil(height) + PADDING_V, MAX_H);
  }

  const style: React.CSSProperties = open
    ? { maxHeight: targetHeight, paddingTop: "0.5rem", paddingBottom: "0.5rem", marginBottom: "0.5rem" }
    : { maxHeight: 0, paddingTop: 0, paddingBottom: 0, marginBottom: 0 };

  return (
    <div className="thinking-block">
      <div className="thinking-toggle" onClick={() => setOpen(!open)}>
        <Brain size={14} />
        <span>{streaming ? "正在思考..." : "思考过程"}</span>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </div>
      <div ref={contentRef} className="thinking-content" style={style}>
        {content}
      </div>
    </div>
  );
}
