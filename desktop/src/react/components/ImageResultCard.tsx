import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Circle,
  ExternalLink,
  Pencil,
  Square,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import type { AttachedFile } from "../types";
import "../styles/image-result.css";

type DrawTool = "pen" | "arrow" | "rect" | "circle";

const PRESET_COLORS = [
  { value: "#D94040", label: "red" },
  { value: "#2563eb", label: "blue" },
  { value: "#C4724A", label: "terracotta" },
  { value: "#1A1A1A", label: "black" },
];

const LINE_WIDTH = 3;
const MAX_UNDO = 20;
const BADGE_LABELS = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";

interface ImageResultCardProps {
  filePath: string;
  workspacePath?: string;
  onSendAnnotation?: (text: string, files: AttachedFile[]) => void;
}

export default function ImageResultCard({
  filePath,
  workspacePath,
  onSendAnnotation,
}: ImageResultCardProps) {
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [annotating, setAnnotating] = useState(false);

  const fileName = filePath.split(/[\\/]/).pop() || filePath;

  useEffect(() => {
    let cancelled = false;
    invoke<string>("read_file_base64", {
      path: filePath,
      workspace: workspacePath || null,
    })
      .then((url) => {
        if (!cancelled) setImgSrc(url);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [filePath, workspacePath]);

  const handleOpen = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent("preview-file", { detail: { path: filePath } }),
    );
  }, [filePath]);

  if (error) return <div className="image-result-loading">无法加载图片</div>;
  if (!imgSrc) return <div className="image-result-loading">加载中…</div>;

  if (annotating) {
    return (
      <AnnotationMode
        imgSrc={imgSrc}
        filePath={filePath}
        workspacePath={workspacePath}
        onCancel={() => setAnnotating(false)}
        onSend={onSendAnnotation}
      />
    );
  }

  return (
    <div className="image-result-card">
      <img className="image-result-img" src={imgSrc} alt={fileName} />
      <div className="image-result-hover-toolbar">
        <button title="标注" onClick={() => setAnnotating(true)}>
          <Pencil size={16} />
        </button>
        <button title="打开" onClick={handleOpen}>
          <ExternalLink size={16} />
        </button>
      </div>
      <div className="image-result-filename">{fileName}</div>
    </div>
  );
}

/* ---- Annotation mode ---- */

interface Annotation {
  text: string;
}

function AnnotationMode({
  imgSrc,
  filePath,
  workspacePath,
  onCancel,
  onSend,
}: {
  imgSrc: string;
  filePath: string;
  workspacePath?: string;
  onCancel: () => void;
  onSend?: (text: string, files: AttachedFile[]) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [tool, setTool] = useState<DrawTool>("arrow");
  const [color, setColor] = useState(PRESET_COLORS[0].value);
  const [undoStack, setUndoStack] = useState<ImageData[]>([]);
  const [sending, setSending] = useState(false);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const inputRefs = useRef<Map<number, HTMLInputElement>>(new Map());

  // Drawing state
  const drawing = useRef(false);
  const startPos = useRef({ x: 0, y: 0 });
  const lastPos = useRef({ x: 0, y: 0 });
  const snapshot = useRef<ImageData | null>(null);

  const [displaySize, setDisplaySize] = useState({ w: 0, h: 0 });

  const handleImgLoad = useCallback(() => {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return;
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    setDisplaySize({ w: img.clientWidth, h: img.clientHeight });
  }, []);

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    const ro = new ResizeObserver(() => {
      setDisplaySize({ w: img.clientWidth, h: img.clientHeight });
    });
    ro.observe(img);
    return () => ro.disconnect();
  }, []);

  const getCtx = useCallback(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) {
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = LINE_WIDTH;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
    }
    return ctx;
  }, [color]);

  const saveUndo = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    setUndoStack((prev) => [
      ...prev.slice(-(MAX_UNDO - 1)),
      ctx.getImageData(0, 0, canvas.width, canvas.height),
    ]);
  }, []);

  const handleUndo = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || undoStack.length === 0) return;
    ctx.putImageData(undoStack[undoStack.length - 1], 0, 0);
    setUndoStack((s) => s.slice(0, -1));
    // Also remove the last annotation (badge + text are one action)
    setAnnotations((a) => (a.length > 0 ? a.slice(0, -1) : a));
  }, [undoStack]);

  const handleClear = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    saveUndo();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setAnnotations([]);
  }, [saveUndo]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if ((e.metaKey || e.ctrlKey) && e.key === "z") { e.preventDefault(); handleUndo(); return; }
      if (e.key === "1") setTool("pen");
      if (e.key === "2") setTool("arrow");
      if (e.key === "3") setTool("rect");
      if (e.key === "4") setTool("circle");
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleUndo, onCancel]);

  const canvasCoords = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement> | React.Touch) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      return {
        x: (e.clientX - rect.left) * (canvas.width / rect.width),
        y: (e.clientY - rect.top) * (canvas.height / rect.height),
      };
    },
    [],
  );

  // Draw numbered badge on canvas
  const drawBadge = useCallback(
    (num: number, cx: number, cy: number) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      const r = Math.max(14, Math.min(canvas.width, canvas.height) * 0.018);
      // Filled circle
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      // Number text
      ctx.fillStyle = "#fff";
      ctx.font = `bold ${Math.round(r * 1.2)}px -apple-system, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(num), cx, cy);
    },
    [color],
  );

  // Complete a drawing stroke: draw badge + add annotation
  const finishStroke = useCallback(() => {
    if (!drawing.current) return;
    drawing.current = false;
    snapshot.current = null;

    const nextNum = annotations.length + 1;
    if (nextNum > 20) return; // max annotations

    // Position badge near the endpoint, offset slightly
    const bx = lastPos.current.x;
    const by = lastPos.current.y;
    drawBadge(nextNum, bx, by);

    setAnnotations((prev) => [...prev, { text: "" }]);

    // Focus the new input after render
    requestAnimationFrame(() => {
      inputRefs.current.get(nextNum - 1)?.focus();
    });
  }, [annotations.length, drawBadge]);

  // --- Mouse handlers ---

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const ctx = getCtx();
      if (!ctx) return;
      saveUndo();
      drawing.current = true;
      const pos = canvasCoords(e);
      startPos.current = pos;
      lastPos.current = pos;
      const canvas = canvasRef.current!;
      snapshot.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
      if (tool === "pen") { ctx.beginPath(); ctx.moveTo(pos.x, pos.y); }
    },
    [tool, getCtx, saveUndo, canvasCoords],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!drawing.current) return;
      const ctx = getCtx();
      if (!ctx) return;
      const pos = canvasCoords(e);
      lastPos.current = pos;

      if (tool === "pen") {
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
      } else {
        if (snapshot.current) ctx.putImageData(snapshot.current, 0, 0);
        if (tool === "arrow") {
          drawArrow(ctx, startPos.current.x, startPos.current.y, pos.x, pos.y);
        } else if (tool === "circle") {
          const cx = (startPos.current.x + pos.x) / 2;
          const cy = (startPos.current.y + pos.y) / 2;
          const rx = Math.abs(pos.x - startPos.current.x) / 2;
          const ry = Math.abs(pos.y - startPos.current.y) / 2;
          ctx.beginPath();
          ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          ctx.strokeRect(
            Math.min(startPos.current.x, pos.x),
            Math.min(startPos.current.y, pos.y),
            Math.abs(pos.x - startPos.current.x),
            Math.abs(pos.y - startPos.current.y),
          );
        }
      }
    },
    [tool, getCtx, canvasCoords],
  );

  // --- Touch handlers ---

  const handleTouchStart = useCallback(
    (e: React.TouchEvent<HTMLCanvasElement>) => {
      if (e.touches.length !== 1) return;
      e.preventDefault();
      const touch = e.touches[0];
      const ctx = getCtx();
      if (!ctx) return;
      saveUndo();
      drawing.current = true;
      const pos = canvasCoords(touch);
      startPos.current = pos;
      lastPos.current = pos;
      const canvas = canvasRef.current!;
      snapshot.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
      if (tool === "pen") { ctx.beginPath(); ctx.moveTo(pos.x, pos.y); }
    },
    [tool, getCtx, saveUndo, canvasCoords],
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent<HTMLCanvasElement>) => {
      if (!drawing.current || e.touches.length !== 1) return;
      e.preventDefault();
      const ctx = getCtx();
      if (!ctx) return;
      const pos = canvasCoords(e.touches[0]);
      lastPos.current = pos;

      if (tool === "pen") {
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
      } else {
        if (snapshot.current) ctx.putImageData(snapshot.current, 0, 0);
        if (tool === "arrow") {
          drawArrow(ctx, startPos.current.x, startPos.current.y, pos.x, pos.y);
        } else if (tool === "circle") {
          const cx = (startPos.current.x + pos.x) / 2;
          const cy = (startPos.current.y + pos.y) / 2;
          const rx = Math.abs(pos.x - startPos.current.x) / 2;
          const ry = Math.abs(pos.y - startPos.current.y) / 2;
          ctx.beginPath();
          ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          ctx.strokeRect(
            Math.min(startPos.current.x, pos.x),
            Math.min(startPos.current.y, pos.y),
            Math.abs(pos.x - startPos.current.x),
            Math.abs(pos.y - startPos.current.y),
          );
        }
      }
    },
    [tool, getCtx, canvasCoords],
  );

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault();
      finishStroke();
    },
    [finishStroke],
  );

  // Update annotation text
  const updateAnnotation = useCallback((idx: number, text: string) => {
    setAnnotations((prev) => prev.map((a, i) => (i === idx ? { text } : a)));
  }, []);

  const removeAnnotation = useCallback(
    (idx: number) => {
      // Can only cleanly remove the last one (undo its badge)
      if (idx === annotations.length - 1) {
        handleUndo();
      } else {
        // For non-last, just clear the text
        updateAnnotation(idx, "");
      }
    },
    [annotations.length, handleUndo, updateAnnotation],
  );

  // Send
  const handleSend = useCallback(async () => {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas || !onSend) return;

    setSending(true);
    try {
      const merged = document.createElement("canvas");
      merged.width = img.naturalWidth;
      merged.height = img.naturalHeight;
      const mCtx = merged.getContext("2d")!;
      mCtx.drawImage(img, 0, 0);
      mCtx.drawImage(canvas, 0, 0);

      const dataUrl = merged.toDataURL("image/png");
      const ts = Date.now();
      const annotPath = `_annotations/annotated-${ts}.png`;

      await invoke<string>("write_file_base64", {
        path: annotPath,
        data: dataUrl,
        workspace: workspacePath || null,
      });

      // Build instruction from numbered annotations
      const parts = annotations
        .map((a, i) => (a.text.trim() ? `${BADGE_LABELS[i]} ${a.text.trim()}` : null))
        .filter(Boolean);
      const instruction = parts.length > 0 ? parts.join("；") : "按照图上标注修改";

      onSend(
        `直接调用 generate_image(prompt="${instruction}", input_image="${annotPath}", filename="generated-${ts}.png")，不要读取文件，不要查找文件，直接执行。`,
        [],
      );
      onCancel();
    } catch (err) {
      console.error("[ImageResultCard] send annotation failed:", err);
    } finally {
      setSending(false);
    }
  }, [onSend, annotations, workspacePath, onCancel]);

  return (
    <div className="image-result-card">
      {/* Toolbar */}
      <div className="image-annotation-toolbar">
        <button className={tool === "pen" ? "active" : ""} onClick={() => setTool("pen")} title="画笔 (1)">
          <Pencil size={15} />
        </button>
        <button className={tool === "arrow" ? "active" : ""} onClick={() => setTool("arrow")} title="箭头 (2)">
          <ArrowUpRight size={15} />
        </button>
        <button className={tool === "rect" ? "active" : ""} onClick={() => setTool("rect")} title="矩形 (3)">
          <Square size={15} />
        </button>
        <button className={tool === "circle" ? "active" : ""} onClick={() => setTool("circle")} title="圆形 (4)">
          <Circle size={15} />
        </button>

        <div className="divider" />

        {PRESET_COLORS.map((c) => (
          <button
            key={c.value}
            className={`color-dot${color === c.value ? " active" : ""}`}
            style={{ backgroundColor: c.value }}
            onClick={() => setColor(c.value)}
            title={c.label}
          />
        ))}
        <label
          className={`color-dot color-custom${!PRESET_COLORS.some((c) => c.value === color) ? " active" : ""}`}
          style={{ backgroundColor: color }}
          title="自定义颜色"
        >
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
        </label>

        <div className="divider" />

        <button onClick={handleUndo} disabled={undoStack.length === 0} title="撤销 (⌘Z)">
          <Undo2 size={15} />
        </button>
        <button onClick={handleClear} title="清空">
          <Trash2 size={15} />
        </button>

        <div style={{ flex: 1 }} />

        <button className="btn-cancel" onClick={onCancel}>取消</button>
        <button className="btn-send" onClick={handleSend} disabled={sending}>
          {sending ? "发送中…" : "发送"}
        </button>
      </div>

      {/* Canvas */}
      <div className="image-result-canvas-wrap">
        <img
          ref={imgRef}
          className="image-result-img"
          src={imgSrc}
          alt="annotation base"
          onLoad={handleImgLoad}
          draggable={false}
        />
        <canvas
          ref={canvasRef}
          className="annotation-canvas"
          style={{ width: displaySize.w, height: displaySize.h }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={finishStroke}
          onMouseLeave={() => { drawing.current = false; snapshot.current = null; }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        />
      </div>

      {/* Annotation list */}
      {annotations.length > 0 && (
        <div className="annotation-list">
          {annotations.map((a, i) => (
            <div key={i} className="annotation-row">
              <span className="annotation-badge" style={{ background: color }}>
                {BADGE_LABELS[i]}
              </span>
              <input
                ref={(el) => {
                  if (el) inputRefs.current.set(i, el);
                  else inputRefs.current.delete(i);
                }}
                className="annotation-input"
                value={a.text}
                onChange={(e) => updateAnnotation(i, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") onCancel();
                }}
                placeholder="描述修改内容…"
              />
              <button
                className="annotation-remove"
                onClick={() => removeAnnotation(i)}
                title="删除"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="image-result-filename">{filePath}</div>
    </div>
  );
}

/* ---- Arrow helper ---- */

function drawArrow(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number, x2: number, y2: number,
) {
  const headLen = Math.max(12, ctx.lineWidth * 4);
  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
  ctx.stroke();
}
