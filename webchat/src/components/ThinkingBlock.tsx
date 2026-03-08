import { useState } from "react";
import { Brain, ChevronDown, ChevronRight } from "lucide-react";

export default function ThinkingBlock({ content, streaming }: { content: string; streaming?: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="thinking-block">
      <div className="thinking-toggle" onClick={() => setOpen(!open)}>
        <Brain size={14} />
        <span>{streaming ? "正在思考..." : "思考过程"}</span>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </div>
      {open && <div className="thinking-content">{content}</div>}
    </div>
  );
}
