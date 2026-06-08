#!/usr/bin/env node
// v0.7.0+ entry shim — delegates to the compiled CLI at dist/cli/main.js
// (re-exported through dist/cli/index.js). See plan §"Phase 2 execution
// detail" Risk R7 for the deferral rationale: the legacy bin file was
// 1359 LOC of dynamically-typed command dispatch; converting it to
// strict-mode TS would have cost 3-4h of type-annotation churn with
// little semantic gain. Shimming to dist/ keeps the entry surface a
// 3-liner while letting the dispatch live under src/ alongside everything
// else compiled by tsc.
import { main } from '../dist/cli/index.js';
main().catch((err) => {
  process.stderr.write(`clud-bug: ${err.message}\n`);
  process.exit(1);
});
