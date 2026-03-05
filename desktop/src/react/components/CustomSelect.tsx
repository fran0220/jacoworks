import { ChevronDown, Check } from "lucide-react";
import { useRef, useState } from "react";
import { useClickOutside } from "../hooks/use-click-outside";

export interface SelectOption {
  value: string;
  label: string;
  badge?: string;
}

export default function CustomSelect({
  options,
  value,
  onChange,
  disabled = false,
  position = "below",
}: {
  options: readonly SelectOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  position?: "above" | "below";
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useClickOutside(wrapperRef, () => setOpen(false), open);

  const selected = options.find((o) => o.value === value);

  return (
    <div className={`cs-wrapper${disabled ? " cs-disabled" : ""}`} ref={wrapperRef}>
      <button
        type="button"
        className={`cs-trigger${open ? " cs-open" : ""}`}
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
      >
        <span className="cs-label">{selected?.label || value}</span>
        <ChevronDown size={12} className={`cs-chevron${open ? " cs-chevron-open" : ""}`} />
      </button>

      {open && (
        <div className={`cs-dropdown cs-dropdown-${position}`}>
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`cs-option${opt.value === value ? " cs-selected" : ""}`}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
            >
              <span className="cs-option-label">{opt.label}</span>
              {opt.badge && <span className="cs-option-badge">{opt.badge}</span>}
              {opt.value === value && <Check size={14} className="cs-check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
