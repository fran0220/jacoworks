import { Users } from "lucide-react";
import type { TeamOption } from "../lib/teams";

interface TeamSelectorProps {
  teams: TeamOption[];
  activeSessionKey: string;
  loading: boolean;
  onChange: (sessionKey: string) => void;
}

export default function TeamSelector({ teams, activeSessionKey, loading, onChange }: TeamSelectorProps) {
  const activeTeam = teams.find((team) => team.sessionKey === activeSessionKey) ?? teams[0];

  return (
    <div className="team-selector">
      <div className="team-selector-label">
        <Users size={14} />
        <span>协作团队</span>
      </div>
      <select
        className="team-selector-input"
        value={activeSessionKey}
        disabled={loading || teams.length === 0}
        onChange={(event) => onChange(event.target.value)}
      >
        {teams.map((team) => (
          <option key={team.sessionKey} value={team.sessionKey}>
            {team.displayName}
          </option>
        ))}
      </select>
      <div className="team-selector-current">会话目标: {activeTeam?.leaderId || "default"}</div>
    </div>
  );
}
