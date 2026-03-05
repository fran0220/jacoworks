import { AlertTriangle } from "lucide-react";
import { useEffect, useRef } from "react";

export default function ConfirmDialog({
  title,
  message,
  confirmLabel = "确认",
  cancelLabel = "取消",
  danger = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="cd-backdrop" onClick={onCancel}>
      <div className="cd-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="cd-header">
          {danger && <AlertTriangle size={18} className="cd-icon-danger" />}
          <h3 className="cd-title">{title}</h3>
        </div>
        <p className="cd-message">{message}</p>
        <div className="cd-actions">
          <button ref={cancelRef} className="cd-btn cd-btn-cancel" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            className={`cd-btn ${danger ? "cd-btn-danger" : "cd-btn-confirm"}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
