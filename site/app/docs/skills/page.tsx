import type { Metadata } from 'next';

const REPO_URL = 'https://github.com/thrillmade/clud-bug';
const SKILLS_SH_URL = 'https://skills.sh';

export const metadata: Metadata = {
  title: 'Review skills — Clud Bug docs',
  description:
    'How clud-bug review skills work: a .claude/skills/<slug>/SKILL.md file with YAML frontmatter, loaded at the PR base ref and cited by slug — kind, applies_to, review_passes, and where skills come from.',
  alternates: { canonical: '/docs/skills' },
};

export default function DocsSkills() {
  return (
    <main className="page">
      <header className="folio">
        <span>A Field Guide to Code Specimens</span>
        <span>Review Skills · MMXXVI</span>
      </header>

      <div className="doc">
        <a className="doc-back" href="/docs">← Field manual</a>

        <header className="doc-head">
          <span className="doc-eyebrow">§ Review Skills</span>
          <h1 className="doc-title">How review skills work.</h1>
          <p className="doc-lede">
            A skill is a plain Markdown file. Clud Bug reads the skills in a
            repository on every pull request and grades the diff against them,
            citing each one by name. Your team&rsquo;s standards become the
            reviewer.
          </p>
        </header>

        <div className="doc-body">
          <h2>1. A skill is a SKILL.md file</h2>
          <p>
            Each skill lives at{' '}
            <code>.claude/skills/&lt;slug&gt;/SKILL.md</code> — a Markdown body
            with a YAML frontmatter block at the head. The body is the
            discipline the reviewer reads; the frontmatter is the routing
            metadata. A minimal one:
          </p>
          <pre><code>{`---
name: critical-issues-only
description: PR review discipline — flag only correctness, security, and performance issues. Skip nits.
---

# Critical issues only

When reviewing a pull request, only surface issues that fall into one of
these buckets: correctness bugs, security vulnerabilities, performance
problems, missing coverage for new code paths. Quote the specific line.
`}</code></pre>
          <p>
            The frontmatter is parsed by <code>parseFrontmatter</code> in{' '}
            <a href={`${REPO_URL}/blob/main/src/core/skills.ts`} rel="noopener">
              src/core/skills.ts</a>. A malformed block is skipped, not fatal —
            one bad skill never takes down the whole review.
          </p>

          <h2>2. Loaded at the base ref, cited by slug</h2>
          <p>
            On each review the bot loads the SKILL.md files from the PR&rsquo;s{' '}
            <strong>base ref</strong> — the branch being merged into, not the
            PR&rsquo;s own head. A pull request therefore cannot weaken the
            skills it will be graded against by editing them in the same diff.
          </p>
          <p>
            Every finding is attributed to the skill that raised it, and the
            review summary carries a per-skill scan line for each loaded skill:
          </p>
          <pre><code>{`### Per-skill scan
- [critical-issues-only]: scanned all paths. 2 critical findings below.
- [brand-voice-review]: scanned 3 microcopy changes. 1 finding (below).
- [pii-and-compliance]: scanned analytics + logging. 0 findings.`}</code></pre>
          <p>
            A review loads at most <strong>eight</strong> skills
            (<code>MAX_SKILLS</code>). Baseline skills are pinned first; the
            remaining slots fill by install count.
          </p>

          <h2>3. Frontmatter fields</h2>
          <table className="doc-table">
            <thead>
              <tr><th>Field</th><th>Meaning</th></tr>
            </thead>
            <tbody>
              <tr><td><code>name</code></td><td>Required. Kebab-case slug — the identity cited in findings.</td></tr>
              <tr><td><code>description</code></td><td>Required. One line on what the skill checks.</td></tr>
              <tr><td><code>source</code></td><td><code>manual</code>, <code>logmind-derived</code>, <code>skills-sh</code>, or <code>clud-bug-baseline</code>.</td></tr>
              <tr><td><code>kind</code></td><td><code>rule</code> (default), <code>voice</code>, or <code>design</code>.</td></tr>
              <tr><td><code>review_mode</code></td><td><code>shared</code> (default) or <code>dedicated</code>.</td></tr>
              <tr><td><code>applies_to</code></td><td>Path globs, extensions, and an optional author login. Absent = load always.</td></tr>
              <tr><td><code>review_passes</code></td><td>Skill-author intent for pass depth — <code>count</code> and <code>mode</code>.</td></tr>
            </tbody>
          </table>

          <h3>kind — what lens the skill speaks to</h3>
          <p>
            <code>rule</code> is an ordinary correctness/convention skill.{' '}
            <code>voice</code> is a copy/brand-voice skill and requires a{' '}
            <code>voice_scope</code> (<code>personal</code>, <code>team</code>,{' '}
            <code>org</code>, or <code>community</code>). <code>design</code>{' '}
            drives the visual design critique rather than the code review — the
            bot renders the changed UI and critiques the screenshots against
            it. See <a href="/docs/config">configuration</a> for the{' '}
            <code>design</code> block that turns that pass on.
          </p>

          <h3>applies_to — scope a skill to the files it cares about</h3>
          <p>
            A skill with <code>applies_to</code> loads only when the diff
            actually touches its territory:
          </p>
          <pre><code>{`applies_to:
  paths:
    - "src/ui/**"
    - "lib/components/**"
  extensions: [".tsx", ".jsx"]
  author: "renovate-bot"`}</code></pre>
          <p>
            <code>paths</code> and <code>extensions</code> are OR&rsquo;d — a
            single changed file matching either is enough. When{' '}
            <code>author</code> is also set, it is AND&rsquo;d: the skill loads
            only for PRs opened by that login. Globs are minimal — <code>*</code>{' '}
            matches within a path segment, <code>**</code> matches across
            slashes, <code>?</code> a single character. A skill with no{' '}
            <code>applies_to</code> block is scope-universal and loads on every
            review.
          </p>

          <h3>review_mode — one shared call, or a dedicated one</h3>
          <p>
            <code>shared</code> skills load together in a single reviewer call
            so their findings cross-correlate. <code>dedicated</code> gives a
            skill its own focused call — reserved for domain skills (brand
            voice, compliance, API contracts) where attention dilution at high
            skill counts is the real failure mode.
          </p>

          <h2>4. Where skills come from</h2>
          <p>
            <strong>The baseline kit.</strong> Four skills ship pinned on every
            install — <code>critical-issues-only</code>,{' '}
            <code>evidence-based-review</code>,{' '}
            <code>respect-existing-conventions</code>, and{' '}
            <code>clud-bug-collaboration</code>. They are the floor discipline
            under every review.
          </p>
          <p>
            <strong>The catalog.</strong> The bot can pull curated and
            searched skills from{' '}
            <a href={SKILLS_SH_URL} rel="noopener">skills.sh</a> and rank them
            in alongside the baselines, capped at eight total.
          </p>
          <p>
            <strong>Your own.</strong> Drop a Markdown file into{' '}
            <code>.claude/skills/</code>, commit it, and Clud Bug cites it by
            name on the next review. This is the moat — a generic reviewer
            grades against generic best practices; a skill grades against{' '}
            <em>your</em> conventions.
          </p>
        </div>

        <a className="doc-back" href="/docs">← Back to the field manual</a>
      </div>

      <footer className="colophon">
        <span>
          Open source. <a href="https://github.com/thrillmade/clud-bug/blob/main/LICENSE">MIT</a>.
        </span>
        <span className="credit">
          a <a href="https://thrillmot.com" rel="noopener">thrillmot</a> project
        </span>
        <span>
          <a href="/docs">docs</a>
          {' · '}
          <a href="/docs/config">config</a>
        </span>
      </footer>
    </main>
  );
}
