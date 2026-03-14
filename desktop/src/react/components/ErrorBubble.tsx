import { AlertTriangle, RefreshCw, RotateCcw } from "lucide-react";

interface ErrorBubbleProps {
  message: string;
  onRetry?: () => void;
  onSwitchModel?: () => void;
}

export default function ErrorBubble({ message, onRetry, onSwitchModel }: ErrorBubbleProps) {
  return (
    <div className="error-bubble">
      <div className="error-bubble-header">
        <AlertTriangle size={15} />
        <span className="error-bubble-title">请求失败</span>
      </div>
      <p className="error-bubble-message">{message}</p>
      {(onRetry || onSwitchModel) && (
        <div className="error-bubble-actions">
          {onRetry && (
            <button className="error-bubble-btn" onClick={onRetry}>
              <RotateCcw size={12} /> 重试
            </button>
          )}
          {onSwitchModel && (
            <button className="error-bubble-btn secondary" onClick={onSwitchModel}>
              <RefreshCw size={12} /> 换个模型
            </button>
          )}
        </div>
      )}
    </div>
  );
}
