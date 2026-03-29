export interface MentionOption {
  id: string;
  mention: string;
  label: string;
  role: string;
  roleLabel: string;
}

export default function MentionPopover({
  open,
  options,
  selectedIndex,
  onSelect,
}: {
  open: boolean;
  options: MentionOption[];
  selectedIndex: number;
  onSelect: (option: MentionOption) => void;
}) {
  if (!open) return null;

  return (
    <div className="mention-popover">
      {options.length > 0 ? (
        options.map((option, index) => {
          const roleClass = option.role ? ` msg-agent-role-badge--${option.role}` : "";

          return (
            <button
              key={option.id}
              type="button"
              className={`mention-item${index === selectedIndex ? " mention-item--active" : ""}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onSelect(option)}
            >
              <div className="mention-item-main">
                <span className={`msg-agent-role-badge${roleClass}`}>{option.roleLabel}</span>
                <span className="mention-item-label">{option.label}</span>
              </div>
              <span className="mention-item-token">{option.mention}</span>
            </button>
          );
        })
      ) : (
        <div className="mention-empty">没有匹配的协作成员</div>
      )}
    </div>
  );
}
