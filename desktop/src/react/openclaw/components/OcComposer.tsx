import { SendHorizontal, Square } from "lucide-react";
import { useRef, useState } from "react";

export default function OcComposer({
  disabled,
  isStreaming,
  onSend,
  onAbort,
}: {
  disabled?: boolean;
  isStreaming: boolean;
  onSend: (text: string) => void;
  onAbort: () => void;
}) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const canSend = !disabled && !isStreaming && text.trim().length > 0;

  const send = () => {
    if (!canSend) return;
    onSend(text.trim());
    setText("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  return (
    <div className="oc-composer">
      <textarea
        ref={textareaRef}
        rows={1}
        value={text}
        disabled={disabled || isStreaming}
        className="oc-input"
        placeholder="向 OpenClaw 发送消息..."
        onInput={(event) => {
          const target = event.currentTarget;
          target.style.height = "auto";
          target.style.height = `${Math.min(target.scrollHeight, 220)}px`;
        }}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            send();
          }
        }}
      />
      <div className="oc-actions">
        {isStreaming ? (
          <button type="button" className="oc-action-btn danger" onClick={onAbort}>
            <Square size={14} />
            停止
          </button>
        ) : (
          <button type="button" className="oc-action-btn primary" onClick={send} disabled={!canSend}>
            <SendHorizontal size={14} />
            发送
          </button>
        )}
      </div>
    </div>
  );
}
