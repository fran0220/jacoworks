import { Check, Flower2, Shield, Sparkles } from "lucide-react";
import { useMemo } from "react";
import {
  DEFAULT_SPRITE_PACK_ID,
  SPRITE_PACKS,
  buildSpriteReferencePath,
  getSpritePack,
  resolveSpritePackId,
  type SpritePack,
} from "../lib/sprite-packs";

const GENDER_META: Record<
  SpritePack["gender"],
  { icon: typeof Shield; label: string }
> = {
  male: { icon: Shield, label: "男" },
  female: { icon: Flower2, label: "女" },
  neutral: { icon: Sparkles, label: "中性" },
};

function AvatarPickerOption({
  pack,
  active,
  onSelect,
}: {
  pack: SpritePack;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  const { icon: GenderIcon, label } = GENDER_META[pack.gender];

  return (
    <button
      type="button"
      className={`avatar-picker-card${active ? " is-active" : ""}`}
      onClick={() => onSelect(pack.id)}
      aria-pressed={active}
      title={`${pack.name} · ${pack.description}`}
    >
      <span className="avatar-picker-preview" style={{ borderColor: pack.accentColor }}>
        <img
          src={pack.preview}
          alt=""
          loading="lazy"
          onError={(event) => {
            const fallbackSrc = buildSpriteReferencePath(DEFAULT_SPRITE_PACK_ID);
            if (event.currentTarget.src.endsWith(fallbackSrc)) return;
            event.currentTarget.src = fallbackSrc;
          }}
        />
      </span>
      <span className="avatar-picker-copy">
        <span className="avatar-picker-headline">
          <strong>{pack.name}</strong>
          <span className={`avatar-picker-gender avatar-picker-gender--${pack.gender}`}>
            <GenderIcon size={12} />
            <span>{label}</span>
          </span>
        </span>
        <span className="avatar-picker-desc">{pack.description}</span>
      </span>
      {active && (
        <span className="avatar-picker-check" aria-hidden="true">
          <Check size={14} />
        </span>
      )}
    </button>
  );
}

export default function AvatarPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const activeId = useMemo(() => resolveSpritePackId(value), [value]);
  const activePack = getSpritePack(activeId);

  return (
    <div className="avatar-picker" role="radiogroup" aria-label="选择角色形象">
      <div className="avatar-picker-toolbar">
        <span className="avatar-picker-toolbar-label">当前形象</span>
        <span className="avatar-picker-toolbar-value" style={{ color: activePack.accentColor }}>
          {activePack.name}
        </span>
      </div>
      <div className="avatar-picker-grid">
        {SPRITE_PACKS.map((pack) => (
          <AvatarPickerOption
            key={pack.id}
            pack={pack}
            active={pack.id === activeId}
            onSelect={onChange}
          />
        ))}
      </div>
    </div>
  );
}
