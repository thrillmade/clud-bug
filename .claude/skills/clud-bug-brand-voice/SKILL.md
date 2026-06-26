---
name: clud-bug-brand-voice
description: Brand voice for the clud-bug product surface — naturalist field-guide aesthetic, irreverent without twee, no joke-explainers. Apply to marketing copy, site/, README, docs/. Don't apply to internal logs or code identifiers.
applies_to:
  paths:
    - "site/**"
    - "docs/**"
    - "README.md"
    - "*.md"
    - "**/marketing/**"
    - "**/copy/**"
  extensions: [".tsx", ".jsx", ".md", ".mdx", ".html"]
---

# Clud-bug brand voice

The clud-bug product surface — cludbug.dev, the App's marketing pages, README, public docs — speaks like a 1950s naturalist's field guide. Observational, irreverent, reader-trusting. The brand DOES NOT explain its own jokes. Visitors who get the field-guide vocabulary get it; visitors who don't get a slightly mysterious naturalist vibe, which is the actual goal.

Your job on this skill is to catch copy that drifts away from this voice — toward generic SaaS speak, toward over-explaining the brand affordances, toward bossy second-person commands, toward features we haven't shipped.

## Vocabulary keepers (use freely; never explain)

- **plate**, **specimen**, **frontispiece**, **marginalia**, **field notes**, **observations**
- `Spec.` as an abbreviation prefix on specimen-card tags (`Spec. brand-voice`, `Spec. api-contract`)
- Fake-Latin **binomials** in italics — *Cluddus bugfindii*, the signature joke. Form: capitalized genus + lowercase species + observational verb. Examples that work:
  - *"Cluddus bugfindii, observed crawling on every PR."*
- `§` numbering for sections, `№` for plates, `MMXXVI` Roman numerals on the masthead, `Vol./No.` notation
- Naturalist verb choices over corporate verbs: *observed*, *catalogued*, *cites*, *pinned*, *foraged* — not "delivers", "drives", "powers"

## Section affordances (the field-guide UI scaffolding)

- Section heads: `§ I — Field Procedure`, `§ II — Specimens for your habitat`, `§ III — A Habit of Three Naturalists`, `§ IV — Field Notes`, `§ V — Observations from the field`, `§ VI — Self-hosted alternative`
- Plate cards: `Plate I — Frontispiece`, `№ I`, the 🐛 bug-pin glyph
- Masthead: `A Field Guide to Code Specimens · Vol. I · No. 1 · MMXXVI`
- These are brand affordances, not labels-pretending-to-be-functional. Don't replace them with `Step 1 / Step 2 / Step 3`.

## NEVER do (with reasons)

### 1. Explain the joke

Tonight we killed `<em>Plate</em>: a labeled illustration in a field guide. <em>Frontispiece</em>: the cover plate.` The gloss block was a dictionary entry under the plate. The joke landed weaker because the field-guide vocabulary had a translation layer pasted next to it.

- **Bad:** `Marginalia (the annotations in the page margin) note that the App carries its own credentials.`
- **Good:** `<aside className="marginalia">No workflow file. No ANTHROPIC_API_KEY rotation. The App carries its own credentials.</aside>`

Don't write parenthetical translations of *plate*, *specimen*, *frontispiece*, *binomial*, the Latin binomials themselves, or the Roman numerals. Don't add `i.e.`, `meaning`, `translates to`, or footnote-style glossaries. Trust the reader.

### 2. Generic SaaS speak

Reflexive blacklist:

- *seamless, powerful, transform your workflow, supercharge, blazing fast, 10x, robust, scalable, world-class, enterprise-grade, mission-critical, next-generation, cutting-edge, best-in-class, drive value, unlock potential, leverage, synergize, take it to the next level*

Each of these is a copy-paste from every other AI dev tools homepage. They have no information content. Replace with a specific observation:

- **Bad:** "Powerful AI PR review that scales with your team."
- **Good:** *"AI PR review with project-aware skills. Install the GitHub App, write a skill, get reviews graded against your conventions on every pull request."* (from `site/app/page.tsx` hero)

### 3. Exclamation marks outside success-state microcopy

Toast like `Review posted!` is fine. Hero like `Install today!` is not. The voice is observational, not salesman-excited. One exclamation per page max, and only when something actually completed.

### 4. Second-person bossy

- **Bad:** "You should install the GitHub App."
- **Bad:** "You must configure your skills."
- **Good:** *"Install the GitHub App on the org or repos you want reviewed. Approve the permissions for pull requests, contents, and checks."* — describes the action, doesn't command.

Observe, don't command. The reader knows they're reading; they don't need to be told to act.

### 5. ALL-CAPS CTAs

- **Bad:** `INSTALL THE GITHUB APP`
- **Good:** `Install the GitHub App` with sentence-case button styling.

### 6. Generic step-explainers without field-guide framing

`Step 1 / Step 2 / Step 3` is corporate. The field-guide form is `§ I — Field Procedure: Three steps. Two minutes per review.` (with naturalist verbs: *Install / Authorize / Reviews land*).

## Locked product facts

**Multi-pass.** Beetle = Pass 1 broad scan. Wasp = Pass 2 cross-check (catches what Beetle missed, suppresses false positives). Mantis = Pass 3 arbiter on disputes only. **Order locked. Names locked** (NOT Inspector/Auditor/Arbiter — those were pre-2026-06). **Multi-pass is App-tier only** — never claim it on the npm/OSS workflow path (PR #165 reviewer caught this). Honest hedge form: *"Same skill engine, same review quality. Multi-pass is App-tier only — the hosted bot orchestrates the three roles server-side."*

**App-first.** Primary CTA every page: *"Install the GitHub App"* → `https://github.com/apps/clud-bug/installations/new`. Secondary, below the fold: *"Self-hosted? Use the open-source workflow →"*. Never lead with the workflow Action.

**Pricing.** Solo $9/mo · Team $29/seat/mo · Pro overage 1.20× Anthropic. Always link to `app.cludbug.dev/pricing` — don't restate prices on other surfaces (the `lib/pricing-display.ts` drift gate exists because we already had this bug). Never name a fixed `$/review` — overage anchors to actual Anthropic cost × multiplier.

**Domains.** `cludbug.dev` = marketing site. `app.cludbug.dev` = product (dashboard + /install + /pricing + /compare). When visible link text is bare domain `app.cludbug.dev`, href must be bare domain — not a subpath (PR #165 footer-fix lesson).

## Brand exemplars — quote these as anchors when reviewing

These are the load-bearing lines from `site/app/page.tsx`. When marketing copy lands in review, cite these as the voice anchors. If the new copy could swap in for one of these without changing the brand vibe, it's on-brand. If it'd feel jarring next to them, it isn't.

> *"AI PR review with project-aware skills."* (hero subtitle)

> *"Install the GitHub App, write a skill, get reviews graded against your conventions on every pull request."* (hero body)

> *"— Cluddus bugfindii, observed crawling on every PR."* (binomial italic, the brand signature)

> *"No workflow file. No ANTHROPIC_API_KEY rotation. The App carries its own credentials and posts inline comments under its own GitHub identity."* (marginalia voice)

> *"Drop a Markdown file into `.claude/skills/` and Clud Bug cites it by name on every review. Your team's standards become the reviewer."* (specimens marginalia)

> *"Three steps. Two minutes per review."* (§ I subtitle — short, observational, no salesman energy)

> *"Same skill engine, same review quality. Multi-pass (Beetle / Wasp / Mantis) is App-tier only — the hosted bot orchestrates the three roles server-side."* (§ VI honest hedge — the model for any feature-availability copy)

## What this skill does NOT cover

- Internal log strings, error messages, function names, code identifiers — `brand-voice-review` (the generic catalog skill) handles these if installed.
- API contract / schema review — `api-contract-enforcement` covers that.
- Accessibility (contrast, ARIA, etc.) — separate skills handle those.

If a review finds a violation that doesn't fit one of the buckets above, surface it under the most specific skill that matches. Avoid double-flagging.
