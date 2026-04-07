# Strategist Reference

Use this file before generating `design_spec.md`.

## Mission

Receive normalized Markdown from `sources/normalized.md`, analyze the content, preserve the local 16-preset style system, and produce a complete `design_spec.md` that can drive SVG generation and native PPTX export.

Pipeline position:

`sources/normalized.md → Strategist → design_spec.md → [Image Generator] → Executor`

## Canvas Formats

Only two presentation canvases are supported in this skill:

| Format | viewBox | Dimensions | Ratio |
|--------|---------|------------|-------|
| PPT 16:9 | `0 0 1280 720` | 1280x720 | 16:9 |
| PPT 4:3 | `0 0 1024 768` | 1024x768 | 4:3 |

## Eight Confirmations

This phase is blocking. Present all items together, then wait for one explicit user confirmation or correction.

### 1. Canvas Format

Recommend `16:9` by default. Use `4:3` only when the deck is intended for legacy projectors, documents, or print-like content density.

### 2. Page Count

Recommend page count based on content volume and density, not only word count. Dense research or consulting material usually needs more pages than a light narrative with the same word count.

### 3. Key Information

Confirm:

- target audience
- usage occasion
- core message
- what the audience should do or understand after the deck

### 4. Style Objective

Choose the execution family first, then the preset.

| Objective | Executor | Best Fit |
|-----------|----------|----------|
| General Versatile | `executor-general.md` | Storytelling, training, product, marketing, education |
| General Consulting | `executor-consultant.md` | Dashboards, business reviews, proposals, reports |
| Top Consulting / Executive | `executor-consultant.md` | Executive persuasion, strategic decision decks |

The chosen objective does not replace the local style preset. It only determines the layout logic and writing tone.

Suggested preset mapping:

- Versatile-heavy: `chalkboard`, `sketch-notes`, `watercolor`, `bold-editorial`, `fantasy-animation`, `vector-illustration`, `vintage`, `dark-atmospheric`, `pixel-art`
- Structured / hybrid: `blueprint`, `editorial-infographic`, `intuition-machine`, `scientific`, `notion`
- Executive / consulting: `corporate`, `minimal`, `blueprint`, `notion`

### 5. Color Scheme

Provide concrete HEX values and keep the palette small.

Rules:

- use the 60-30-10 balance as a default
- maintain text contrast ratio >= 4.5:1
- avoid more than 4 major colors on one slide
- make mood and industry consistent with the chosen preset

### 6. Icon Usage

Decide one icon policy:

- emoji
- built-in icon placeholders via `<use data-icon="...">`
- custom brand icons
- no icons

If icon placeholders are allowed, list the approved icon names in the design spec so execution stays constrained.

### 7. Typography Plan

Define:

- title direction from the chosen typography dimension
- body font direction
- emphasis font direction
- base body size according to density

Suggested body-size baseline:

| Density | Body Size |
|---------|-----------|
| minimal / relaxed | 24px |
| balanced | 20-22px |
| dense | 18px |

### 8. Image Usage

Choose one of:

- no supporting images
- user-provided images
- AI-generated supporting images
- placeholders only

Important: supporting images are embedded inside SVG. They are not slide-sized raster exports.

Image layout rule:

| Image Ratio | Recommended Layout |
|-------------|-------------------|
| > 2.0 | Top-bottom split, image full-width |
| 1.5-2.0 | Top-bottom split |
| 1.2-1.5 | Left-right split |
| 0.8-1.2 | Left-right split |
| < 0.8 | Left-right split, image on left |

Never force a wide image into a square slot or a portrait image into a thin banner.

## Turning Presets Into SVG Rules

The strategist must translate the selected preset into explicit SVG execution guidance.

| Dimension | What to write into `design_spec.md` |
|-----------|-------------------------------------|
| Texture | background primitives, stroke behavior, edge treatment |
| Mood | palette, gradient behavior, contrast level |
| Typography | title/body/emphasis roles, casing, letter spacing, tone |
| Density | content-block count, padding, safe-area occupancy |

Example:

- `blueprint` should describe grid logic, cool palette, technical labels, and balanced information blocks.
- `chalkboard` should describe warm backgrounds, chalk-like strokes, and hand-written title treatment.

## `design_spec.md` Structure

Use English section headings and keep the order fixed.

1. Project Information
2. Canvas Specification
3. Visual Theme
4. Typography System
5. Layout Principles
6. Icon Usage Spec
7. Chart Reference List
8. Image Resource List
9. Content Outline
10. Speaker Notes Requirements
11. Technical Constraints Reminder
12. Design Checklist
13. Next Steps

## Required Content In Each Section

### I. Project Information

- project name
- topic slug
- audience
- scenario
- selected preset
- selected executor family
- date

### II. Canvas Specification

- format
- dimensions
- fixed viewBox
- safe margins
- content area

### III. Visual Theme

- preset and dimension mix
- palette table with HEX values
- light or dark base
- gradient usage rules
- background logic

### IV. Typography System

- title/body/emphasis direction
- font-size hierarchy
- line-height guidance
- density-related scaling rules

### V. Layout Principles

- default grid or free-layout logic
- reusable layout families
- spacing rules
- when to use image-led or data-led slides

### VI. Icon Usage Spec

- icon policy
- approved icon list, if any
- preferred icon sizes and colors

### VII. Chart Reference List

List only when the deck truly needs charts. The chart choice belongs here; per-slide outline entries only reference the chart type name.

### VIII. Image Resource List

Use a table with:

- filename
- dimensions
- ratio
- purpose
- type
- status
- generation description

### IX. Content Outline

One entry per slide with:

- slide number
- filename
- title
- narrative goal
- content points
- layout direction
- chart type if applicable
- image usage if applicable

### X. Speaker Notes Requirements

- deck language
- note tone
- total duration target
- note-file naming rule

### XI. Technical Constraints Reminder

Must restate the SVG rules that the executor must follow:

- fixed viewBox
- absolute coordinates only
- no `clipPath`, `mask`, `style`, `animate`, `foreignObject`
- icon placeholders via `<use data-icon="...">`
- images via `<image href="../images/...">`

### XII. Design Checklist

Include pre-generation and post-generation checks for content fit, contrast, density, and technical compatibility.

### XIII. Next Steps

State the exact next stage:

- go directly to executor
- or run image generation first, then executor

## Final Strategist Rules

- Do not write slide SVG during strategist phase.
- Do not ask the eight confirmations in separate turns.
- After confirmation, continue automatically unless the user explicitly asked for review.
- `design_spec.md` is the single source of truth for all downstream SVG and PPTX work.
