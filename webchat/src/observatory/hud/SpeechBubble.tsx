interface SpeechBubbleProps {
  text: string;
  type: "status" | "summary" | "info";
  leaderName: string;
  leaderRole: string;
  visible: boolean;
}

export default function SpeechBubble({ text, type, leaderName, visible }: SpeechBubbleProps) {
  if (!visible || !text) return null;

  return (
    <div className={`speech-bubble speech-bubble--${type}`}>
      <div className="speech-bubble-text">{text}</div>
      {type === "summary" && (
        <div className="speech-bubble-footer">— {leaderName}</div>
      )}
    </div>
  );
}
