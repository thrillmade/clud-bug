## 2026-05-29 09:34 - 0.0.T (clud-bug side): RTK-inspired tee-hint on cap fire — producer-side audit trail

**Reasoning:** lib/prompts.js: previously the prompt reactively asked the LLM to notice and request truncated content (line 122-123 pre-change: 'If you genuinely cannot review safely without the elided content, say so plainly'). RTK's force_tee_tail_hint (src/cmds/python/ruff_cmd.rs:214-219) is producer-side: when the cap fires, the producer NAMES what was elided. The patch ports that energy to our context — on any observed cap fire, the prompt now requires (1) one targeted re-fetch with doubled cap on the specific section and (2) a ### Diagnostics block in the summary listing each cap that fired + outcome. This makes truncation auditable instead of confidence-loss-shaped. Golden gate (test/golden/must-contain.json) locks the new section against future 0.0.P trim — 3 new entries (Tee-hint on cap fire, Attempt ONE targeted re-fetch, ### Diagnostics).

**Alternatives considered:** Leaving the prompt reactive (existing behavior) means the LLM might omit content silently if it doesn't notice the cut — exactly the Q6 silent-drop pattern we are eliminating elsewhere., A separate producer-side wrapper around the head -c invocation (RTK's actual force_tee_tail_hint mechanic) would have to intercept the LLM's bash command output and inject the tee-hint. Not feasible without changes to claude-code-action; instruction-level is the right surface.

**Implications:**
- Budget cap bumps required: max_prompt_bytes 16000 → 18500 (rendered 17080, +1.1 KB for new section); max_prompt_lines 360 → 380 (rendered 362, +33 lines). Both intentional with why-field rationale and CHANGELOG entry pointing here. Leaves ~1.4 KB headroom for the upcoming 0.0.O JSON schema directive.
- Composite-pin lock-step 0.6.17 → 0.6.18 in templates/workflow{,-py,-ts}.yml.tmpl + .github/actions/strict-mode-gate/action.yml header docs.

---
