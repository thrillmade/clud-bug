#!/usr/bin/env node
// Release-gate guard: every version string this repo publishes or documents
// must be valid SemVer.
//
// Why this exists (clud-bug #251, 2026-07-25): an upstream skills-refresh
// workflow bumped our version with `p.version.split('.').map(Number)`, which
// assumes X.Y.Z. We ship PRERELEASES — `0.7.0-rc.26` splits to
// ["0","7","0-rc","26"], `Number("0-rc")` is NaN, and the PR wrote a literal
// `"version": "0.7.NaN"` into package.json AND a `## [0.7.NaN]` CHANGELOG
// heading. Full CI passed. It merged to main. `npm publish` would have failed
// at the registry — the first place anything would have noticed.
//
// The generator has since been fixed upstream (it no longer assigns versions
// at all — that is the publisher's act). This guard is the local backstop:
// whatever writes a version, valid SemVer is checked here, on every PR.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// The official SemVer 2.0.0 regex (semver.org, "Backus-Naur Form Grammar for
// Valid SemVer Versions"). Anchored, no capture groups needed here.
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

const errors = [];

// 1. package.json — the string npm publishes under.
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (typeof pkg.version !== 'string' || !SEMVER.test(pkg.version)) {
  errors.push(
    `package.json version is not valid SemVer: ${JSON.stringify(pkg.version)}`,
  );
}

// 2. CHANGELOG.md release headings — `## [x.y.z] — date`, plus the literal
//    `## [Unreleased]` staging header. #251 corrupted this file too, so
//    checking only package.json would have caught half the damage.
const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
for (const [, heading] of changelog.matchAll(/^## \[([^\]]+)\]/gm)) {
  if (heading === 'Unreleased') continue;
  if (!SEMVER.test(heading)) {
    errors.push(`CHANGELOG.md heading is not valid SemVer: ## [${heading}]`);
  }
}

if (errors.length > 0) {
  for (const e of errors) console.error(`::error::${e}`);
  console.error(
    `\ncheck-version: ${errors.length} invalid version string(s). ` +
      `See scripts/check-version.mjs for why this guard exists.`,
  );
  process.exit(1);
}

console.log(`check-version: ok (package.json ${pkg.version})`);
