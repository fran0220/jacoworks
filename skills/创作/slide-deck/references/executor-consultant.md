# Executor Consultant Reference

Use this file for report-like, business, analytical, or executive decks.

Typical presets:

- `corporate`
- `minimal`
- `blueprint`
- `notion`
- `editorial-infographic`
- `intuition-machine`
- `scientific`

## Mission

Create structured SVG slides optimized for persuasion, analysis, and data clarity while preserving editability in the final PPTX.

## Core Principles

- titles should make an assertion, not merely describe a topic
- every data-heavy page needs one takeaway
- charts use restrained, monotone hierarchy rather than rainbow palettes
- decorations stay secondary to logic

## Standard Components

### Takeaway Box

Content slides should usually include a concise takeaway band near the top.

Recommended box for 1280x720:

- x=40
- y=80
- w=1200
- h=50
- light theme tint background
- 14-16px one-sentence summary

### KPI Cards

Standard four-card layout for dashboards:

```text
Card 1: x=45,  y=160, w=280, h=180
Card 2: x=355, y=160, w=280, h=180
Card 3: x=665, y=160, w=280, h=180
Card 4: x=975, y=160, w=280, h=180
```

Internal structure:

- icon row: 32x32
- metric label: 14px gray
- core number: 36-42px bold
- trend line: 12px with up/down/flat cue

### Left-Chart Right-Insight Layout

Strong default for analytical slides:

- chart area: x=40, y=120, w=700, h=480
- insight area: x=780, y=120, w=460, h=480

Use the right column for:

- conclusion
- 3-5 evidence bullets
- source or implication note

## Chart Color Rules

Keep charts disciplined:

- primary series: theme color at full strength
- comparison series: theme color at reduced opacity
- baseline or target: gray dashed line
- highlight only key data points with accent color

Do not use rainbow palettes unless the design spec explicitly demands a categorical chart that needs them.

## Data Annotation Rules

- label values directly when possible
- annotate turning points or important dates
- keep numeric units consistent inside each chart
- mark targets, averages, or thresholds visibly

## Tables

For tables, prefer:

- dark or tinted header row
- zebra striping for body rows
- right-aligned numbers
- left-aligned text
- horizontal separators over full grid lines

## Titles And Sources

### Assertion Titles

Prefer:

- `Gross margin improved for four consecutive quarters`
- `User retention now contributes most of the growth`

Avoid:

- `Financial Data`
- `Retention Analysis`

### Data Source Attribution

Every data page should carry a small source line near the bottom.

Example:

```xml
<text x="40" y="700" font-size="10" fill="#94A3B8">Source: Internal analysis; public filings 2025</text>
```

## Speaker Notes Tone

Consulting notes should be conclusion-first.

Recommended flow:

1. state the conclusion
2. cite 2-3 supporting facts
3. explain implication or next step

Useful localized markers:

- transition marker
- pause marker
- data marker for verbalizing numbers naturally

## Self-Check

- Does the title state the insight?
- Is there a visible takeaway on the page?
- Are chart colors restrained and consistent?
- Does every data page include a source?
- Would an executive understand the conclusion in a quick skim?
