# Executor Base Reference

Read this file before generating any slide SVG.

## Mission

Consume `design_spec.md`, generate slide SVG files that obey strict compatibility rules, then hand them to the Python post-processing pipeline so they become editable PowerPoint shapes.

## Mandatory Preflight

Before the first slide, explicitly restate these parameters from `design_spec.md`:

- canvas format and dimensions
- fixed viewBox
- primary / secondary / accent colors
- body font size baseline
- typography direction
- selected preset and executor family

This prevents drift between planning and execution.

## Generation Discipline

- The main agent generates the whole deck.
- Do not delegate slide SVG creation to sub-agents.
- Generate pages sequentially, one by one, in slide order.
- Keep the full design context alive across pages.
- Finish the visual phase before writing speaker notes.

## File Locations

| Artifact | Path |
|---------|------|
| Raw SVG | `svg_output/NN-slide-{slug}.svg` |
| Finalized SVG | `svg_final/NN-slide-{slug}.svg` |
| Master notes | `notes/total.md` |
| Per-slide notes | `notes/NN-slide-{slug}.md` |

Use two-digit numbering: `01`, `02`, `03`.

## SVG Compatibility Rules

### Canvas

- `16:9` decks must use `viewBox="0 0 1280 720"`
- `4:3` decks must use `viewBox="0 0 1024 768"`
- Use absolute coordinates for every element
- Keep all important content inside the safe area defined by `design_spec.md`

### Allowed Core Elements

Use simple SVG that maps well to DrawingML:

- `svg`
- `defs`
- `linearGradient`
- `radialGradient`
- `g`
- `rect`
- `circle`
- `ellipse`
- `line`
- `polyline`
- `polygon`
- `path`
- `text`
- `tspan`
- `image`
- `use` with `data-icon`

### Forbidden or Discouraged Elements

Do not use:

- `clipPath`
- `mask`
- `style`
- `animate` or animation tags
- `foreignObject`
- external CSS
- embedded scripts
- filter-heavy tricks that flatten editability

When you need rounded corners, cropping, or icon embedding, rely on `finalize_svg.py`, not unsupported SVG tricks.

### Text Rules

- Write text directly with `<text>` / `<tspan>`
- Keep line breaks deliberate and explicit
- Avoid CSS classes; use inline attributes
- Respect the typography plan from `design_spec.md`

### Shape Rules

- Prefer primitive shapes when possible
- Use `path` only when needed for custom geometry
- Keep coordinates clean and stable
- Favor reusable layout patterns over decorative complexity

## Template Mapping Declaration

Before each slide, declare the layout approach:

```text
Template mapping: None (free design) or inherited structure
Layout strategy: one-sentence explanation of how this slide follows the design spec
```

This skill does not require SVG template files, but the same discipline still applies: be explicit about what structure you are carrying forward.

## Icons

Icons must use placeholder syntax so post-processing can replace them with actual SVG paths.

```xml
<use data-icon="chart-bar" x="100" y="200" width="48" height="48" fill="#005587"/>
```

Rules:

- only use icon names approved in `design_spec.md`
- keep icon sizes explicit
- use icons as supporting cues, not as the slide's only structure

## Images

Supporting images are referenced from `images/`.

```xml
<image href="../images/cover-bg.png" x="0" y="0" width="1280" height="720" preserveAspectRatio="xMidYMid slice"/>
```

If the asset is not ready yet, use a visible placeholder:

```xml
<rect x="80" y="120" width="560" height="320" rx="24" fill="none" stroke="#94A3B8" stroke-dasharray="8,4"/>
```

## Speaker Notes Phase

After all slide SVG files are complete:

1. write `notes/total.md`
2. localize note labels to the presentation language
3. keep every slide after slide 1 opening with a transition marker
4. then split notes with `total_md_split.py`

Required structure per slide note:

- 2-5 sentences of script
- `Key points:` line
- `Duration:` line

## Export Pipeline

Run these commands in order:

```bash
python ${SKILL_DIR}/scripts/python/total_md_split.py <slide-deck-dir>
python ${SKILL_DIR}/scripts/python/finalize_svg.py <slide-deck-dir>
python ${SKILL_DIR}/scripts/python/svg_to_pptx.py <slide-deck-dir> -s final
```

Rules:

- never skip `finalize_svg.py`
- never export directly from raw `svg_output/`
- rerun the full export pipeline after regenerating selected slides
