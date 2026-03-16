#!/usr/bin/env python3
"""
Blender Scene Review — 调用 Gemini 3.1 Pro 严格审核渲染图。

使用 LLM 中转站的 Gemini 原生协议，传入渲染 PNG 截图，
返回结构化评审报告（评分 + 问题清单 + 修复建议）。

环境变量:
  LLM_PROXY_URL  — 中转站地址 (默认 http://67.230.182.59:8317)
  LLM_PROXY_KEY  — API 密钥 (必须)

用法:
  python3 scripts/blender/review-scene.py /tmp/office-build/step8-structure.png
  python3 scripts/blender/review-scene.py /tmp/office-build/step8-structure.png --strict
  python3 scripts/blender/review-scene.py /tmp/office-build/step8-structure.png --reference /tmp/office-build/step7-polish.png
"""
import sys
import os
import json
import base64
import urllib.request
import urllib.error
import argparse

PROXY_URL = os.environ.get("LLM_PROXY_URL", "http://67.230.182.59:8317")
PROXY_KEY = os.environ.get("LLM_PROXY_KEY", "")
MODEL = os.environ.get("REVIEW_MODEL", "gpt-5.4")

STRICT_PROMPT = """\
你是一位资深 3D 场景审核专家，正在审核一个用 Kenney Furniture Kit 低多边形模型资产在 Blender 中构建的等距办公室场景。

**重要背景**：这是低多边形 (low-poly) 风格场景，使用 Kenney 资产包。以下是该风格的固有特征，不应扣分：
- 低多边形模型的边缘是锐利的、简化的，不是高精度建模
- 等距视角下，由于透视压缩，桌面小物件（显示器、键盘、鼠标）可能看起来略有间隙，但只要在桌面范围内且数值上已对齐就算合格
- Kenney 模型的底座都是平底设计，与桌面之间的微小间隙是资产本身的特征，不算浮空
- 等距视角下外墙角件 (wallCorner) 是独立的 L 形模型，与直墙段之间有设计上的接缝，不算缺口
- 门洞 (wallDoorway) 是有意为之的通行开口，不算外墙缺口

请以**公正标准**逐项检查以下方面，给出 1-10 分评分和详细问题清单：

## 审核维度

### 1. 结构完整性 (权重 25%)
- 外墙是否形成完整围合？（角件接缝和门洞开口不算缺口）
- 内部隔断墙是否连续？门洞位置是否合理？
- 地板铺设是否完整覆盖整个空间？

### 2. 家具摆放 (权重 25%)
- 大型家具（桌子、椅子、沙发、书架）是否正确放在地面上？
- 桌面物品（显示器、笔记本、台灯）是否在桌面范围内？（低多边形风格下的微小间隙不算浮空）
- 物品是否超出房间边界或明显嵌入墙壁？
- 家具布局是否符合使用逻辑？

### 3. 区域识别度 (权重 25%)
- 5个功能区（Hub 大厅、Forge 开发区、Tower 创意会议室、Court 评审室、Lounge 茶歇区）是否能明确区分？
- 每个区域是否有标志性家具/地毯/道具？
- Hub: 有前台、等候区、展示元素
- Forge: 多工位阵列、任务板、开发氛围
- Tower: 设计师沙发、演示大屏、创意会议感
- Court: 评审长桌、观众席、正式氛围
- Lounge: 沙发、厨房角、吧台、休闲氛围
- 走廊/过渡区是否有装饰？

### 4. 视觉质量 (权重 25%)
- 整体构图是否平衡？
- 色彩是否有足够变化？是否有足够绿植？
- 场景密度是否合适（不过空也不过密）？
- 是否有"故事感"（生活化的小道具）？

## 输出格式

```json
{
  "overall_score": 8.5,
  "dimensions": {
    "structure": {"score": 9, "issues": ["..."]},
    "furniture": {"score": 8, "issues": ["..."]},
    "zone_identity": {"score": 7, "issues": ["..."]},
    "visual_quality": {"score": 9, "issues": ["..."]}
  },
  "critical_issues": ["必须修复的问题"],
  "improvements": ["建议改进的点"],
  "verdict": "PASS" | "NEEDS_FIX" | "FAIL"
}
```

verdict 标准:
- **PASS**: overall_score ≥ 8.0 且无 critical_issues
- **NEEDS_FIX**: overall_score ≥ 6.0 或有 critical_issues
- **FAIL**: overall_score < 6.0

请严格按 JSON 格式输出，不要加 markdown 代码块标记。
"""

COMPARISON_PROMPT = """\
你是一位资深 3D 场景审核专家。请对比两张渲染图：
- **第一张**: 最新版本（待审核）
- **第二张**: 上一版本（参考）

请分析最新版本相比上一版本的改进和退步，并给出严格评分。
"""


def load_image_b64(path: str) -> str:
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode()


def call_gemini(prompt: str, images: list[tuple[str, str]]) -> str:
    """Call Gemini via proxy OpenAI-compatible endpoint with vision.
    images: list of (base64_data, mime_type)
    """
    # Build multimodal content array for OpenAI vision format
    content = []
    for b64, mime in images:
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:{mime};base64,{b64}"}
        })
    content.append({"type": "text", "text": prompt})

    payload = {
        "model": MODEL,
        "messages": [{"role": "user", "content": content}],
        "temperature": 0.2,
        "max_tokens": 4096,
    }

    url = f"{PROXY_URL}/v1/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {PROXY_KEY}",
    }

    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers=headers,
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        print(f"❌ API Error {e.code}: {body}", file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"❌ Connection Error: {e.reason}", file=sys.stderr)
        sys.exit(1)

    # Extract text from OpenAI-compatible response
    try:
        text = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError):
        print(f"❌ Unexpected response: {json.dumps(data, indent=2)}", file=sys.stderr)
        sys.exit(1)

    return text


def parse_review(text: str) -> dict:
    """Try to parse JSON from the review text."""
    # Strip markdown code blocks if present
    cleaned = text.strip()
    if cleaned.startswith("```"):
        lines = cleaned.split("\n")
        lines = [l for l in lines if not l.strip().startswith("```")]
        cleaned = "\n".join(lines)

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        # Try to find JSON in the text
        start = cleaned.find("{")
        end = cleaned.rfind("}") + 1
        if start >= 0 and end > start:
            try:
                return json.loads(cleaned[start:end])
            except json.JSONDecodeError:
                pass
    return None


def print_review(review: dict):
    """Pretty-print the review result."""
    verdict = review.get("verdict", "UNKNOWN")
    score = review.get("overall_score", 0)

    icon = {"PASS": "✅", "NEEDS_FIX": "⚠️", "FAIL": "❌"}.get(verdict, "❓")

    print(f"\n{'='*60}")
    print(f"  {icon} Scene Review: {verdict} (Score: {score}/10)")
    print(f"{'='*60}\n")

    dims = review.get("dimensions", {})
    for name, data in dims.items():
        s = data.get("score", "?")
        print(f"  📊 {name}: {s}/10")
        for issue in data.get("issues", []):
            print(f"     • {issue}")
        print()

    critical = review.get("critical_issues", [])
    if critical:
        print("  🚨 Critical Issues:")
        for c in critical:
            print(f"     ❌ {c}")
        print()

    improvements = review.get("improvements", [])
    if improvements:
        print("  💡 Improvements:")
        for imp_item in improvements:
            print(f"     → {imp_item}")
        print()


def main():
    parser = argparse.ArgumentParser(description="Review Blender scene render with Gemini 3.1 Pro")
    parser.add_argument("image", help="Path to rendered PNG")
    parser.add_argument("--reference", help="Path to reference/previous PNG for comparison")
    parser.add_argument("--strict", action="store_true", help="Enable extra-strict mode")
    parser.add_argument("--raw", action="store_true", help="Print raw API response")
    args = parser.parse_args()

    if not PROXY_KEY:
        print("❌ LLM_PROXY_KEY environment variable not set", file=sys.stderr)
        print("   export LLM_PROXY_KEY=your-key-here", file=sys.stderr)
        sys.exit(1)

    if not os.path.exists(args.image):
        print(f"❌ Image not found: {args.image}", file=sys.stderr)
        sys.exit(1)

    print(f"🔍 Reviewing: {args.image}")
    print(f"   Model: {MODEL}")
    print(f"   Proxy: {PROXY_URL}")

    images = [(load_image_b64(args.image), "image/png")]

    prompt = STRICT_PROMPT
    if args.reference:
        if os.path.exists(args.reference):
            images.append((load_image_b64(args.reference), "image/png"))
            prompt = COMPARISON_PROMPT + "\n\n" + STRICT_PROMPT
            print(f"   Reference: {args.reference}")
        else:
            print(f"   ⚠️ Reference not found, skipping: {args.reference}")

    if args.strict:
        prompt += "\n\n⚠️ 额外严格模式：评分标准上浮 1 分。8 分以上才算 PASS。任何浮空、穿模、缺口都算 critical issue。"

    print(f"\n   ⏳ Calling Gemini 3.1 Pro...")
    text = call_gemini(prompt, images)

    if args.raw:
        print(f"\n--- Raw Response ---\n{text}\n---")

    review = parse_review(text)
    if review:
        print_review(review)

        # Save review to JSON file
        out_json = args.image.replace(".png", "-review.json")
        with open(out_json, "w") as f:
            json.dump(review, f, indent=2, ensure_ascii=False)
        print(f"  📄 Review saved: {out_json}")

        # Exit code based on verdict
        if review.get("verdict") == "FAIL":
            sys.exit(2)
        elif review.get("verdict") == "NEEDS_FIX":
            sys.exit(1)
        else:
            sys.exit(0)
    else:
        print(f"\n⚠️ Could not parse JSON review. Raw response:\n{text}")
        sys.exit(1)


if __name__ == "__main__":
    main()
