# Executor General Reference

Use this file for non-consulting decks and expressive visual storytelling.

Typical presets:

- `chalkboard`
- `sketch-notes`
- `watercolor`
- `bold-editorial`
- `fantasy-animation`
- `vector-illustration`
- `vintage`
- `dark-atmospheric`
- `pixel-art`

Hybrid structured presets such as `blueprint` or `editorial-infographic` may also use this mode when the deck is explanatory rather than executive-consulting.

## Mission

Create visually engaging SVG slides that still remain editable and structurally simple enough for SVG → DrawingML conversion.

## Layout Modes

Use the layout language that best fits each slide's narrative goal.

| Layout | 1280x720 Guidance | Best For |
|--------|-------------------|----------|
| Full-image + text overlay | image fills canvas; overlay text in safe zone | Covers, transitions, emotional pages |
| Left-right split | left x=40 w=580; right x=660 w=580 | Explanations, feature pages, image-text mixes |
| Three-column cards | x=40 / 450 / 860; each w=380 | Lists, comparisons, pillars |
| Top-bottom split | top h=250; bottom h=420 | Timelines, processes, layered narratives |
| Center-radiating | center node with 4-6 satellites | Ecosystems, concept maps |
| Waterfall / Z-pattern | alternate block alignment | Storytelling, case studies |

## Visual Rhythm

- Alternate dense pages with breathing pages.
- Keep chapter-level consistency, not deck-wide monotony.
- Let one dominant element lead each slide.
- Decorative elements should support hierarchy, not replace it.

## Applying The Local Style Dimensions

### Texture

- `clean`: flat planes, crisp cards, minimal noise
- `grid`: subtle engineering grid, measured alignments
- `organic`: hand-drawn or soft-edged support shapes
- `pixel`: stepped shapes, 8-bit geometry, square corners
- `paper`: warm base fills, frame edges, archival accents

### Mood

- `warm`: softer backgrounds, humane contrast
- `cool`: clean blue/teal logic, technical calm
- `vibrant`: high-energy accents, stronger contrast points
- `dark`: deep background with luminous highlight layers
- `neutral`: grayscale foundation with restrained accent color

### Typography

- `handwritten`: informal headings and labels, careful legibility
- `editorial`: strong headline contrast, magazine rhythm
- `humanist`: approachable, friendly paragraph voice
- `geometric`: crisp modular structure
- `technical`: coded labels, measured annotation tone

### Density

- `minimal`: one message, few modules, generous white space
- `balanced`: 2-4 structured modules
- `dense`: compact cards, charts, and concise annotation

## Typography Hierarchy

Default general-style hierarchy:

- title: 28-36px
- subtitle: 20-24px
- body: 16-18px
- annotation: 12-14px

Raise or lower sizes according to the design spec's density plan.

## Decorative Elements

Allowed motifs that still convert well:

- gradient blocks
- rounded cards
- numbered circles
- divider lines
- icon markers via `data-icon`
- simple halos or layered rectangles for depth

Avoid effects that depend on unsupported SVG features.

## Speaker Notes Tone

General decks should sound conversational and presentable.

Preferred patterns:

- scenario → tension → resolution
- simple metaphors for abstract ideas
- natural-language rendering of numbers
- occasional interaction cues when appropriate

Useful markers:

- localized transition marker
- localized pause marker
- localized interactive marker when audience engagement helps

## Self-Check

- Is there one clear focal point on the slide?
- Does the chosen preset still read clearly after simplifying to editable SVG?
- Is the page rhythm balanced against neighboring slides?
- Are decorative elements subordinate to the content?
