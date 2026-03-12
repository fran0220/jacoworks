import { useRef, useCallback } from "react";

export default function Composer({
  disabled,
  streaming,
  onSend,
  onAbort,
}: {
  disabled: boolean;
  streaming: boolean;
  onSend: (text: string) => void;
  onAbort: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isComposingRef = useRef(false);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, []);

  const handleSend = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    const text = el.value.trim();
    if (!text || disabled || streaming) return;
    onSend(text);
    el.value = "";
    autoResize();
  }, [disabled, streaming, onSend, autoResize]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey && !isComposingRef.current && !e.nativeEvent.isComposing) {
        e.preventDefault();
        if (!streaming) handleSend();
      }
    },
    [streaming, handleSend],
  );

  return (
    <div className="composer">
      <div className="composer-inner">
        <textarea
          ref={textareaRef}
          placeholder="输入消息... (Shift+Enter 换行)"
          rows={1}
          disabled={disabled}
          onInput={autoResize}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => { isComposingRef.current = true; }}
          onCompositionEnd={() => { isComposingRef.current = false; }}
        />
        {streaming ? (
          <button className="abort-btn" onClick={onAbort}>停止</button>
        ) : (
          <button className="send-btn" disabled={disabled} onClick={handleSend}>发送</button>
        )}
      </div>
    </div>
  );
}
