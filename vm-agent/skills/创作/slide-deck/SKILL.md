---
name: slide-deck
display-name: 演示幻灯片
display-description: 从内容生成可编辑原生 PPTX 幻灯片（SVG → DrawingML）
description: >
  Generates editable PowerPoint slide decks from content by normalizing source material to Markdown,
  producing a design spec, generating per-slide SVG, and converting SVG into native DrawingML shapes.
  Preserves the existing 16-preset style system. Use when the user asks to create slides, a deck,
  a presentation, PPT, 演示文稿, or 幻灯片.
---

# Slide Deck Generator

Generate editable slide decks with a three-stage pipeline:

`source → Markdown → design_spec.md → slide SVG → finalize_svg.py → svg_to_pptx.py`

This skill replaces the old bitmap-slide workflow. AI now writes SVG XML directly, and Python post-processing converts SVG elements into native PowerPoint DrawingML so the final `.pptx` stays editable.

## Usage

```bash
/slide-deck path/to/content.md
/slide-deck path/to/content.pdf --style blueprint
/slide-deck path/to/content.docx --audience executives
/slide-deck https://example.com/article --lang zh
/slide-deck path/to/content.md --slides 12 --format 16:9
/slide-deck path/to/content.md --outline-only
/slide-deck slide-deck/topic-slug --svg-only
/slide-deck slide-deck/topic-slug --regenerate 3
```

## Script Directory

Determine this skill directory as `SKILL_DIR`. All pipeline scripts should be invoked with the sidecar Python runtime via:

```bash
python ${SKILL_DIR}/scripts/python/<script>.py <args>
```

Expected Python script entrypoints:

| Script | Purpose |
|--------|---------|
| `scripts/python/pdf_to_md.py` | PDF → Markdown normalization |
| `scripts/python/doc_to_md.py` | DOCX / office docs → Markdown normalization (Pandoc-backed) |
| `scripts/python/web_to_md.py` | URL / HTML → Markdown normalization |
| `scripts/python/total_md_split.py` | Split `notes/total.md` into per-slide notes |
| `scripts/python/finalize_svg.py` | SVG post-processing: icon embedding, image prep, cleanup |
| `scripts/python/svg_to_pptx.py` | Convert SVG into native editable PPTX |

## Options

| Option | Description |
|--------|-------------|
| `--style <name>` | One of the 16 presets, `custom`, or a custom style name |
| `--audience <type>` | Target audience: beginners, intermediate, experts, executives, general |
| `--lang <code>` | Output language for confirmations, summaries, and slide content |
| `--slides <number>` | Target slide count (8-25 recommended, max 30) |
| `--format <16:9\|4:3>` | Canvas format. Default `16:9` |
| `--outline-only` | Stop after `design_spec.md` is generated |
| `--design-only` | Alias of `--outline-only` |
| `--images-only` | Generate supporting image assets from an existing design spec |
| `--svg-only` | Generate SVG, notes, and PPTX from an existing design spec |
| `--regenerate <N>` | Regenerate specific slide SVG(s): `3` or `2,5,8` |

**Slide Count by Content Length**

| Content | Slides |
|---------|--------|
| < 1000 words | 5-10 |
| 1000-3000 words | 10-18 |
| 3000-5000 words | 15-25 |
| > 5000 words | 20-30 |

## Style System

The existing 16-preset system stays intact. The difference is that the style is now expressed as SVG constraints instead of image-generation prompts.

### Presets

| Preset | Dimensions | Best For |
|--------|------------|----------|
| `blueprint` (Default) | grid + cool + technical + balanced | Architecture, system design |
| `chalkboard` | organic + warm + handwritten + balanced | Education, tutorials |
| `corporate` | clean + professional + geometric + balanced | Investor decks, proposals |
| `minimal` | clean + neutral + geometric + minimal | Executive briefings |
| `sketch-notes` | organic + warm + handwritten + balanced | Educational, tutorials |
| `watercolor` | organic + warm + humanist + minimal | Lifestyle, wellness |
| `dark-atmospheric` | clean + dark + editorial + balanced | Entertainment, gaming |
| `notion` | clean + neutral + geometric + dense | Product demos, SaaS |
| `bold-editorial` | clean + vibrant + editorial + balanced | Product launches, keynotes |
| `editorial-infographic` | clean + cool + editorial + dense | Tech explainers, research |
| `fantasy-animation` | organic + vibrant + handwritten + minimal | Educational storytelling |
| `intuition-machine` | clean + cool + technical + dense | Technical docs, academic |
| `pixel-art` | pixel + vibrant + technical + balanced | Gaming, developer talks |
| `scientific` | clean + cool + technical + dense | Biology, chemistry, medical |
| `vector-illustration` | clean + vibrant + humanist + balanced | Creative, children's content |
| `vintage` | paper + warm + editorial + balanced | Historical, heritage |

### Dimensions → SVG Constraints

| Dimension | SVG impact |
|-----------|------------|
| **Texture** | Background treatment, stroke style, edge treatment, grid/paper/pixel behavior |
| **Mood** | Palette, contrast, gradient intensity, dark/light balance |
| **Typography** | Font family direction, weight hierarchy, label tone |
| **Density** | Safe-area occupancy, number of content blocks, white-space budget |

Reference files to preserve and reuse:

- `references/dimensions/*.md`
- `references/styles/*.md`
- `references/design-guidelines.md`
- `references/layouts.md`

## Output Directory

```text
slide-deck/{topic-slug}/
├── sources/
│   ├── source-{slug}.{ext}
│   └── normalized.md
├── design_spec.md
├── images/
│   └── image_prompts.md
├── svg_output/
│   └── 01-slide-cover.svg, 02-slide-{slug}.svg, ...
├── svg_final/
│   └── 01-slide-cover.svg, 02-slide-{slug}.svg, ...
├── notes/
│   ├── total.md
│   └── 01-slide-cover.md, 02-slide-{slug}.md, ...
└── {topic-slug}.pptx
```

`topic-slug` should stay short, kebab-case, and human-readable.

## Language Handling

Detection priority:

1. `--lang`
2. `EXTEND.md` `language`
3. User conversation language
4. Source content language

Rules:

- All user-facing confirmations, progress updates, and summaries use the preferred language.
- `design_spec.md` uses English section headings and field labels, even if content values are Chinese or another language.
- Technical identifiers, filenames, and code stay in English.

## Workflow

Copy this checklist and keep it updated while executing:

```text
Slide Deck Progress:
- [ ] Step 1: Setup & Ingest
  - [ ] 1.1 Load preferences
  - [ ] 1.2 Normalize source to Markdown
  - [ ] 1.3 Analyze content
  - [ ] 1.4 Check existing output ⚠️ REQUIRED
- [ ] Step 2: Strategist confirmation ⚠️ REQUIRED
- [ ] Step 3: Generate design_spec.md
- [ ] Step 4: Review design spec (conditional)
- [ ] Step 5: Generate supporting images (conditional)
- [ ] Step 6: Generate SVG slides
- [ ] Step 7: Generate speaker notes
- [ ] Step 8: Finalize SVG and export PPTX
- [ ] Step 9: Output summary
```

Pipeline flow:

```text
Input → Normalize → Analyze → Existing Check → Eight Confirmations → design_spec.md → [Image Assets] → SVG → Notes → finalize_svg.py → svg_to_pptx.py
```

## Step 1: Setup & Ingest

### 1.1 Load Preferences

Check `EXTEND.md` in this order:

```bash
test -f .jacoworks/skills/slide-deck/EXTEND.md && echo project
test -f "$HOME/.jacoworks/skills/slide-deck/EXTEND.md" && echo user
```

When found, summarize the loaded preferences for the user: style, audience, language, and review preference.

Schema: `references/config/preferences-schema.md`

### 1.2 Normalize Source to Markdown

All downstream work consumes `sources/normalized.md`.

| Source | Action |
|--------|--------|
| Markdown / plain text | Copy or clean into `sources/normalized.md` |
| PDF | `python ${SKILL_DIR}/scripts/python/pdf_to_md.py <input> -o sources/normalized.md` |
| DOCX / office docs | `python ${SKILL_DIR}/scripts/python/doc_to_md.py <input> -o sources/normalized.md` |
| URL | `python ${SKILL_DIR}/scripts/python/web_to_md.py <url> -o sources/normalized.md` |

Notes:

- `doc_to_md.py` is expected to use bundled Pandoc.
- Keep the original source file under `sources/` alongside `normalized.md`.
- If `sources/normalized.md` already exists, back it up with a timestamp before overwriting.

### 1.3 Analyze Content

Use `references/analysis-framework.md` and the existing style system to determine:

- recommended preset or custom dimension mix
- target slide count
- audience and usage scenario
- likely executor family: `general` or `consultant`
- whether supporting images are needed at all

### 1.4 Check Existing Output

This check is mandatory before asking for confirmations.

```bash
test -d "slide-deck/{topic-slug}" && echo exists
```

If output already exists, ask one bundled question and wait. Typical paths:

- regenerate `design_spec.md` only
- reuse `design_spec.md`, regenerate SVG/PPTX only
- regenerate selected slides via `--regenerate`
- clean rebuild from source

## Step 2: Strategist Confirmation

Read `references/strategist.md` before entering this phase.

This is the single blocking checkpoint for deck planning. Present all eight confirmation items together and wait for explicit approval or edits:

1. canvas format
2. page count
3. key information: audience, occasion, core message
4. style objective
5. color scheme
6. icon usage
7. typography plan
8. image usage

Rules:

- Do not start `design_spec.md` before confirmation.
- Do not ask follow-up planning questions one by one.
- Once confirmed, continue automatically through the non-blocking stages.

## Step 3: Generate `design_spec.md`

`design_spec.md` replaces the old prompt bundle as the central planning artifact. It must include the 13 sections defined in `references/strategist.md`, including:

- canvas specification with fixed SVG viewBox
- style preset and dimension breakdown
- typography system and spacing rules
- icon inventory or icon policy
- chart reference list
- image resource list
- slide-by-slide content outline
- speaker-note requirements
- technical SVG constraints
- next-step handoff

If you are invoking the current Python utilities before their filename migration is complete, keep a script-compatible copy such as `design_specification.md` alongside `design_spec.md`.

If `--outline-only` or `--design-only` is set, stop here.

## Step 4: Review Design Spec

Only pause here if review is enabled by user preference or explicitly requested.

Offer three choices:

1. proceed to execution
2. edit `design_spec.md` first
3. regenerate the design spec with a different direction

## Step 5: Generate Supporting Images

This phase is optional. It exists only for image assets listed in `design_spec.md`, not for full slides.

Read `references/image-generator.md` before starting.

Rules:

- Generate `images/image_prompts.md` first.
- Supporting assets may be AI-generated, user-provided, or placeholders.
- Never generate whole-slide PNGs as the main presentation medium.
- Generated assets are later referenced from SVG in `svg_output/` using `<image href="../images/...">`.
- Run one image generation task at a time.

If `--images-only` is set, start here from an existing `design_spec.md`.

## Step 6: Generate SVG Slides

Read `references/executor-base.md` plus exactly one style execution file:

- `references/executor-general.md`
- `references/executor-consultant.md`

Execution rules:

- The main agent must generate all slide SVG sequentially in one continuous context.
- No sub-agent delegation for slide generation.
- Generate one slide at a time, in order.
- Save raw slide SVG into `svg_output/`.
- Use fixed absolute coordinates with `viewBox="0 0 1280 720"` for `16:9` or `viewBox="0 0 1024 768"` for `4:3`.
- Use icon placeholders like `<use data-icon="chart-bar" .../>`.
- Do not use `clipPath`, `mask`, `style`, `animate`, `foreignObject`, scripts, or CSS-class-based styling.

If `--svg-only` is set, start from an existing `design_spec.md`.

If `--regenerate <N>` is set:

1. read the existing design spec
2. regenerate only the selected slide SVG files
3. rerun Step 7 and Step 8

## Step 7: Generate Speaker Notes

After all SVG slides are written:

1. create `notes/total.md`
2. keep labels localized to the deck language
3. ensure every slide after slide 1 starts with a transition phrase
4. split notes with `python ${SKILL_DIR}/scripts/python/total_md_split.py <slide-deck-dir>`

## Step 8: Finalize SVG and Export PPTX

Run the post-processing pipeline in this exact order:

```bash
python ${SKILL_DIR}/scripts/python/total_md_split.py <slide-deck-dir>
python ${SKILL_DIR}/scripts/python/finalize_svg.py <slide-deck-dir>
python ${SKILL_DIR}/scripts/python/svg_to_pptx.py <slide-deck-dir> -s final
```

Rules:

- Never skip `finalize_svg.py`.
- Never export directly from raw `svg_output/` when `svg_final/` is expected.
- The final `.pptx` should contain editable shapes, text, and charts wherever the converter supports them.

## Step 9: Output Summary

Summarize:

- topic and style preset
- output directory
- slide count
- whether supporting images were used
- generated SVG path
- `notes/total.md`
- final `.pptx`

## Partial Workflows

| Option | Workflow |
|--------|----------|
| `--outline-only` / `--design-only` | Steps 1-3 only |
| `--images-only` | Start at Step 5 |
| `--svg-only` | Start at Step 6 |
| `--regenerate N` | Regenerate selected slides, then rerun notes + export |

## Reference Files

New SVG-native references:

- `references/strategist.md`
- `references/executor-base.md`
- `references/executor-general.md`
- `references/executor-consultant.md`
- `references/image-generator.md`

Existing references that remain valid:

- `references/analysis-framework.md`
- `references/outline-template.md`
- `references/content-rules.md`
- `references/design-guidelines.md`
- `references/layouts.md`
- `references/base-prompt.md`
- `references/modification-guide.md`
- `references/config/preferences-schema.md`
- `references/dimensions/*.md`
- `references/styles/*.md`

## Notes

- SVG is the editable intermediate format; PNG is no longer the main slide artifact.
- The SVG and DrawingML models are both absolute-coordinate 2D canvases, which is why this conversion pipeline works well.
- Keep slides self-contained for reading and sharing, not just live presentation.
- When images are needed, they are supporting assets inside SVG, not flattened slides.
