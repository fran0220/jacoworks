import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { AgentExpression, AgentPresenceTone } from "../types";
import {
  DEFAULT_SPRITE_PACK_ID,
  buildSpriteReferencePath,
  buildSpriteSheetPath,
  getSpritePack,
  resolveSpritePackId,
} from "../lib/sprite-packs";

const EXPRESSION_META: Record<
  AgentExpression,
  {
    label: string;
    tone: AgentPresenceTone;
  }
> = {
  idle: { label: "待命中", tone: "idle" },
  thinking: { label: "思考中...", tone: "thinking" },
  speaking: { label: "正在回应...", tone: "thinking" },
  working: { label: "编写代码...", tone: "working" },
  happy: { label: "任务完成", tone: "idle" },
  error: { label: "出了点状况", tone: "idle" },
};

export default function SpriteAvatar({
  spritePackId = DEFAULT_SPRITE_PACK_ID,
  expression,
  size,
  onToggle,
}: {
  spritePackId?: string;
  expression: AgentExpression;
  size: "sm" | "lg";
  onToggle: () => void;
}) {
  const resolvedPackId = resolveSpritePackId(spritePackId);
  const spritePack = useMemo(() => getSpritePack(resolvedPackId), [resolvedPackId]);
  const [spriteSheetSrc, setSpriteSheetSrc] = useState(() => buildSpriteSheetPath(spritePack.id, expression));
  const [referenceSrc, setReferenceSrc] = useState(() => buildSpriteReferencePath(spritePack.id));
  const [imageReady, setImageReady] = useState(false);

  useEffect(() => {
    setSpriteSheetSrc(buildSpriteSheetPath(spritePack.id, expression));
    setImageReady(false);
    const handle = window.requestAnimationFrame(() => {
      setImageReady(true);
    });
    return () => {
      window.cancelAnimationFrame(handle);
    };
  }, [expression, spritePack.id]);

  useEffect(() => {
    setReferenceSrc(buildSpriteReferencePath(spritePack.id));
  }, [spritePack.id]);

  const meta = EXPRESSION_META[expression];

  const ariaLabel = useMemo(() => {
    return size === "sm"
      ? `${spritePack.name}，${meta.label}，点击展开`
      : `${spritePack.name}，${meta.label}，点击收起`;
  }, [meta.label, size, spritePack.name]);

  const avatarStyle = useMemo(
    () => ({ "--sprite-pack-accent": spritePack.accentColor } as CSSProperties),
    [spritePack.accentColor],
  );

  return (
    <button
      type="button"
      className={`sprite-avatar sprite-avatar--${size} sprite-avatar--${meta.tone} is-${expression}${imageReady ? " is-ready" : ""}`}
      onClick={onToggle}
      aria-label={ariaLabel}
      title={ariaLabel}
      style={avatarStyle}
    >
      <span className="sprite-avatar-frame">
        {size === "sm" ? (
          <img
            className="sprite-avatar-image"
            src={referenceSrc}
            alt=""
            onError={() => {
              const fallbackSrc = buildSpriteReferencePath(DEFAULT_SPRITE_PACK_ID);
              if (referenceSrc !== fallbackSrc) {
                setReferenceSrc(fallbackSrc);
                setImageReady(false);
                window.requestAnimationFrame(() => setImageReady(true));
              }
            }}
          />
        ) : (
          <span
            className="sprite-avatar-image sprite-avatar-image--sheet"
            aria-hidden="true"
            style={{ backgroundImage: `url(${spriteSheetSrc})` }}
          />
        )}
        <span className="sprite-avatar-status-dot" aria-hidden="true" />
        {size === "lg" && <span className="sprite-avatar-orbit" aria-hidden="true" />}
      </span>

      {size === "lg" && (
        <span className="sprite-avatar-info">
          <span className="sprite-avatar-name">{spritePack.name}</span>
          <span className="sprite-avatar-status-text">{meta.label}</span>
        </span>
      )}
    </button>
  );
}
