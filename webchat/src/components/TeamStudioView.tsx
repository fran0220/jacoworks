import TeamPanel from "./TeamPanel";

interface TeamStudioViewProps {
  activeSessionKey: string;
  onSwitchTeam: (key: string) => void;
}

export default function TeamStudioView({ activeSessionKey, onSwitchTeam }: TeamStudioViewProps) {
  return (
    <div className="team-studio-view">
      <TeamPanel
        activeSessionKey={activeSessionKey}
        onSwitchTeam={onSwitchTeam}
      />
    </div>
  );
}
