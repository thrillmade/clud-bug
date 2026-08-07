← back to [docs/timeline.md](../timeline.md)

## 2026-08-07 17:32 - Fix 265: per-tool files get a redirect stub, not a copy of the instruction block (SPEC 2.0 §1.1/§1.2)

**Reasoning:** agents-md.ts copied the whole clud-bug block into all 7 per-tool files (CLAUDE.md, GEMINI.md, copilot-instructions.md, .cursorrules, .windsurfrules, .clinerules, .continuerules) plus .cursor/rules/*.md. SPEC 2.0 §1.1: 'AGENTS.md is the single source of agent instructions. A tool MUST NOT copy its content into any other file.' §1.2: 'A per-tool file MUST NOT carry a copy of the instructions. A markdown one is a redirect and nothing else.' Seven copies have seven drift rates. The 0.0.I.1 escape hatch (hasAgentsMdImport -> removeBlock) already did the right thing, but only for files carrying Claude Code's @AGENTS.md import — Cursor/Windsurf/Cline/Continue/Gemini/Copilot have no @-import, so they never qualified and always kept the copy. Now every per-tool file is stripped and given a 3-line stub; AGENTS.md alone keeps the block.

**Alternatives considered:** Write logmind's byte-for-byte '<!-- logmind-stub: ... -->' from the §1.2 example (rejected: §1.1 says each tool owns ONE marked region and MUST leave others byte-identical, so clud-bug writing logmind's marker is the clobbering §1.1 forbids; and its text promises a decision-logging requirement that a logmind-less repo does not have — we use <!-- clud-bug-stub: --> and RECOGNISE logmind's stub so only one redirect ever lands). Truncate per-tool files to the stub so they are literally 'a redirect and nothing else' (rejected: eats hand-written .cursorrules content clud-bug never authored). Bundle the two sibling items from the issue — lastUpdate churn on a 0-change run, and the block-version downgrade guard (rejected: the downgrade guard needs an ordering rule for a non-numeric id like 'v2' — a design decision, not a mechanical fix).

**Implications:**
- Consuming repos see their per-tool copies replaced by a stub on next init/update — a one-time migration diff. Adversarial cases covered and tested: hand-edits around the block survive; content AFTER the end marker survives (upsertBlock's non-greedy replace is now pinned by a test — its comment claimed 'greedy' and was wrong about its own regex); running twice is a byte-identical no-op (3-run diff test). Two latent defects found and fixed while widening removeBlock's blast radius: it welded surrounding lines together ('HEAD\n\n<block>\nMIDDLE' -> 'HEADMIDDLE') and mangled CRLF files into 3 blank lines. removeBlock is now global (a bad merge leaving two copies must end at zero, not one) and line-ending aware. Stub links are depth-relative so .github/ and .cursor/rules/ do not get dead links. JSON per-tool paths (.sourcegraph/cody.json, .zed/settings.json) are still untouched, guarded by a test, per §1.2's 'MUST NOT write markdown into them'. 1077 tests pass, tsc clean, fixtures 5/5.

---

## 2026-08-07 17:33 - Rename branch worktree-wf_14b1bd88-5b1-3 -> fix/265-redirect-stubs and move its decision file to match

**Reasoning:** The orchestrator seeded this worktree with a machine-generated branch name. Every other PR on this repo uses the fix/<issue>-<slug> convention (fix/260-base-ref-skills, fix/263-skill-kind-writing, fix/264-ci-evidence-delete-probes), and logmind routes decisions to docs/decisions-branches/<branch>.md — so the branch rename has to carry the decision file with it or the file is orphaned under a name no branch owns.

**Alternatives considered:** Leave the worktree branch name (rejected: an opaque PR head ref nobody can read, and it breaks the naming pattern reviewers scan by). Delete and re-log the decision on the new branch (rejected: rewrites the timestamp and loses the original entry).

**Implications:**
- PR head ref is fix/265-redirect-stubs. No code change in this commit — pure rename, so a reviewer can skip it.

---

## 2026-08-07 17:33 - Regenerate docs/timeline.md on the branch so check-derived-docs starts green

**Reasoning:** check-derived-docs (inside regen-timeline.yml, not a file of that name) regenerates the derived docs in CI and pushes a fix commit when they are stale. Doing it here means the PR opens coherent instead of collecting a bot commit.

**Alternatives considered:** Let the bot regenerate it (rejected: adds a commit to the PR and re-runs every check for no reason). Also regenerate docs/file-structure.md (rejected: this session runs inside a git worktree, where logmind renders the WORKTREE DIRECTORY as the tree root and corrupts the file — and this change adds no files, so file-structure has nothing to pick up).

**Implications:**
- docs/timeline.md now lists the #265 entries. docs/file-structure.md deliberately left alone.

---

