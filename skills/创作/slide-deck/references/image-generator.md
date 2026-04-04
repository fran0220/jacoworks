# Image Generator Reference

This phase is optional. Use it only when `design_spec.md` says the deck needs supporting image assets.

## Mission

Generate or prepare supporting images that will be embedded inside SVG slides. This phase does not create slide-sized PNG outputs.

Pipeline position:

`design_spec.md → image assets → SVG executor`

## Inputs

Read from `design_spec.md`, especially:

- visual theme
- palette and mood
- canvas format
- image resource list in section VIII

## Outputs

| Artifact | Path |
|---------|------|
| Prompt document | `images/image_prompts.md` |
| Generated assets | `images/` |
| Updated status | reflected in the resource list or summary |

Critical rule: `images/image_prompts.md` must be written to disk before image generation begins.

## Standard Prompt Record

Each asset should use this structure in `image_prompts.md`:

```markdown
### Image N: filename.ext

| Attribute | Value |
| --------- | ----- |
| Purpose | Cover background / section divider / inline illustration |
| Type | Background / Photography / Illustration / Diagram / Decorative |
| Dimensions | 1600x900 (16:9) |
| Original description | Short user or strategist description |

**Prompt**:
Detailed generation prompt here.

**Negative Prompt**:
What to exclude.

**Alt Text**:
> Accessibility description here.
```

## Asset Types

| Type | Typical Use | Guidance |
|------|-------------|----------|
| Background | Cover or chapter backdrops | Leave negative space for overlaid text |
| Photography | Real-world people, places, products | Use only when realism helps |
| Illustration | Concept art, character, metaphor | Match the selected preset's visual language |
| Diagram | Architecture, process, concept support | Keep it clean and interpretable |
| Decorative | Patterns, dividers, textures | Stay subtle |

## Local Adaptation Rules

- Generated images are supporting assets, not the final slide artifact.
- The SVG executor must still own layout, text, and slide structure.
- If the deck can be explained with native SVG shapes alone, skip this phase.
- When user images already exist, prefer reusing them instead of regenerating.

## Generation Discipline

- work one asset at a time
- verify file output before moving on
- keep filenames aligned with the design spec
- prefer transparent backgrounds for isolated decorative assets when useful

The actual generation backend may be the sidecar `generate_image` tool or a project-specific Python wrapper when available. The planning artifact is always the same: `images/image_prompts.md`.

## SVG Handoff Rules

The executor references these assets from `svg_output/` like this:

```xml
<image href="../images/asset-name.png" x="..." y="..." width="..." height="..." preserveAspectRatio="xMidYMid slice"/>
```

When the asset is not ready, the executor must use a placeholder instead of inventing a flattened slide image.

## Completion Checklist

- `images/image_prompts.md` exists on disk
- every requested asset has a prompt record
- generated files are saved under `images/`
- filenames match the design spec
- the deck can now proceed to SVG execution
