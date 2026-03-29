import TeamPanel from "./TeamPanel";

export default function TeamStudioView({
  activeSessionKey,
  onSwitchTeam,
}: {
  activeSessionKey: string;
  onSwitchTeam: (key: string) => void;
}) {
  return (
    <section className="view-shell view-shell--team">
      <TeamPanel activeSessionKey={activeSessionKey} onSwitchTeam={onSwitchTeam} />
    </section>
  );
}
