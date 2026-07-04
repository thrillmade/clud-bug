---
name: designing-elite-ui
description: Visual review — hold the rendered UI to a concrete elite/Figma-grade bar (one-axis color, APCA-gated contrast, floating stable chrome, dark verified) instead of a vague "looks fine." The STANDARD a design-critic measures against.
kind: design
review_mode: dedicated
applies_to:
  paths: ["site/**", "app/**", "**/components/**", "**/ui/**"]
  extensions: [".tsx", ".jsx", ".css", ".scss", ".vue", ".svelte"]
---

# Designing Elite UI

## Overview

The design *bar* is the standard; the QA loop is the enforcement (see `orchestrating-elite-agent-qa`). A critic with no encoded bar finds nothing — "looks fine." This skill is the bar: the transferable taste an agent designs *to* and critiques *against*. **Encode it explicitly** (a tokens file + a short design-system doc) so both builders and the critic share one source of truth.

## The Principles

1. **One semantic role → one meaning → one variation axis.** Give each role a band where *exactly one* dimension varies and the rest lock; it reads deliberate, not random. **Reserve a color for ONE meaning only.** (Example below: structures vary hue at locked L/C; power "draws" vary hue, never red; power *infrastructure* is red, reserved.)
2. **Contrast is gated, not eyeballed.** APCA-check every text-on-fill. A theme flip needs its *own* ramp (a dark draw ramp, derived dark reds) — never reuse the light values on a dark surface.
3. **Restraint beats richness.** Distinguish by hue-in-band + shape + label, not a rainbow. Plain text labels with a subtle active state, not boxy segmented controls. Tinted/outline active states over heavy solid fills. Retire decoration that doesn't carry meaning.
4. **Type: one family + its mono.** Mono for data, codes, and labels; optical centering (`text-box-trim`); restrained weights. Consistency over variety.
5. **The canvas is stable; chrome floats.** The work surface NEVER reflows or rescales on selection (lock px-per-unit). Panels float *over* it; the toolbar morphs smoothly; one icon language; a per-context accent. Infinite/dotted background beats a white card on a page.
6. **Interaction feels alive before the click.** Cursor affordances (resize cursors on handles, grab/grabbing on pan), hover highlights, valid/invalid ghost tints, smooth transitions, unmistakable active states.
7. **Light and dark are BOTH primary.** Design and verify in both; neither is an afterthought.
8. **Optical, not metric, alignment.** Center to the eye (text trim, icon nudge); balance a frame so no element reads as an afterthought; never ship a clipped focus ring.

## Gotchas That Quietly Break the Bar

| Symptom | Cause / fix |
|---|---|
| Popover text clipped / see-through | A `backdrop-filter` ancestor traps even `position:fixed` children → **portal the popover to `<body>`**; opaque frame + inner scroll owns any fade-mask. |
| Pill/toolbar drifts off-center | `left:50%` on an auto-width fixed element caps it to 50vw → wrap in a full-width flex container, center inside; recompute after layout settles. |
| Dark mode looks washed/low-contrast | Light tokens reused on dark → add explicit dark ramps; re-run APCA. |
| Two controls read "active" at once | Mode vs tool both filled with the accent → give the resting one a tinted/outline state. |
| Glyph looks wrong only when rotated | Glyph drawn fixed while footprint swapped → re-orient the silhouette with the rotation. |

## Encode the Bar (so it's enforceable)

The bar only bites if it's written down where agents read it:
- **Tokens** in one file (colors as the actual system, not ad-hoc hex), emitted to CSS vars.
- **A design-system doc** (a SPEC section / memory) stating the domains, the variation axis per role, the type rules, the chrome model.
- **Feed it to the design-critic**: "challenge the render against THIS bar in light + dark" — not "is it nice?". Vague critics pass everything.

**REQUIRED COMPANION:** `orchestrating-elite-agent-qa` is how this bar gets enforced per slice (the browser-driving critic gate).

## Worked Example (one system, fully specified)

Burning-Man hub editor, build-free vanilla JS:
- **Color = OKLCH, three domains, one axis each.** Structures (fills) = cool band blue→purple→pink, vary **hue**, lock L≈.88/C≈.07; neutral types near-grey. Power "draws" (need badges) = warm band green→orange, vary **hue**, NO red (it also colors the wires). Power infrastructure (generator · drops · distros · fire-lanes · hazard) = **red, reserved**; drops vary **lightness** only. Colors-off → one uniform grey for all structures; the semantic red/badges stay. APCA-gate every amp label + draw chip.
- **Type:** Geist + Geist Mono; mono for ids/amps/metadata; `text-box-trim` centering.
- **Chrome:** stable dotted infinite canvas (px-per-foot locked across select/deselect); floating inspector + center-bottom morphing toolbar pill (Lucide icons, per-mode accent); slide-up legend with plain text-on-surface tabs (not a boxy segmented box), content inset ~15%.
- **Interaction:** orientation-aware resize cursors on edge/vertex handles; SimCity ghost preview (valid/invalid tint) before placement; soft red "needs-power" halos, not hard error tiles, for in-progress states.

## Deploying This Skill (per writing-skills)

A reference/taste skill — test by **retrieval + application**: give an agent a UI task with this skill loaded and check the output actually exhibits the principles (one-axis color, APCA, floating chrome, dark verified), not just that it read them. Tighten any principle an agent reads but doesn't apply.
