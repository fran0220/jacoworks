# Template Resources

This migrated `slide-deck` skill currently bundles the subset of `ppt-master`
template assets needed by the Python pipeline shipped in this repository.

## Design Specification Reference

`design_spec_reference.md` is the core planning template for:
1. Visual specifications: canvas, color, typography, layout principles
2. Content outline: slide-by-slide planning
3. SVG/DrawingML compatibility constraints

[View Design Spec Reference](./design_spec_reference.md)

## Icon Library

The `icons/` directory contains the bundled vector icon set used by
`finalize_svg.py` and `svg_finalize/embed_icons.py`.

- Human browsing: [icons/README.md](./icons/README.md)
- AI / Programmatic lookup: [icons/icons_index.json](./icons/icons_index.json)

## Not Included Yet

The upstream `ppt-master` repository also ships reusable layout and chart
template packs. Those global template packs are not part of this initial
vm-agent migration yet, so references to `layouts/` or `charts/` in upstream
docs should be treated as future work.
