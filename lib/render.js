import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { serializedReviewSchema } from './review-schema.js';

const PLACEHOLDER_RE = /\{\{([A-Z_]+)\}\}/g;

// CLUD_BUG_VERSION (0.0.O / v0.6.22) — read from this package's
// package.json at module-load time. The rendered workflow uses
// `npx --yes clud-bug@<CLUD_BUG_VERSION>` in the post-step that renders
// structured output to markdown. Pinning to the version that ran
// `clud-bug init` guarantees the renderer's output shape matches the
// prompt's expectations.
const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_VERSION = JSON.parse(
  readFileSync(join(__dirname, '..', 'package.json'), 'utf8'),
).version;

// Default values for substitution tokens that every template uses.
// Callers can override per-render by passing the same key in `vars`.
//
// CCA_VERSION pins `anthropics/claude-code-action` to a specific tag in
// every shipped workflow. Without this, templates resolved `@v1` (the
// floating major), so upstream changes could silently land in installed
// workflows mid-cycle. Bumping the pin requires a clud-bug release, which
// makes the upgrade visible + lets users opt out by pinning a different
// version in their own forked workflow.
export const DEFAULTS = {
  CCA_VERSION: 'v1.0.133',
  CLUD_BUG_VERSION: PKG_VERSION,
  REVIEW_SCHEMA: serializedReviewSchema(),
};

// Multi-line value substitution preserves YAML/Markdown indentation by
// applying the placeholder line's leading whitespace to every
// continuation line. Single-line values pass through unchanged so
// existing tokens (CCA_VERSION, PROJECT_DESCRIPTION) keep current behavior.
export function render(template, vars) {
  const merged = { ...DEFAULTS, ...vars };
  return template.replace(PLACEHOLDER_RE, (match, key, offset) => {
    if (!(key in merged)) {
      throw new Error(`Missing template variable: ${key}`);
    }
    const value = String(merged[key]);
    if (!value.includes('\n')) {
      return value;
    }
    const lineStart = template.lastIndexOf('\n', offset - 1) + 1;
    const leadingWhitespaceMatch = template.slice(lineStart, offset).match(/^(\s*)/);
    const indent = leadingWhitespaceMatch ? leadingWhitespaceMatch[1] : '';
    return value
      .split('\n')
      .map((line, i) => (i === 0 || line === '' ? line : indent + line))
      .join('\n');
  });
}

export async function renderFile(path, vars) {
  const tmpl = await readFile(path, 'utf8');
  return render(tmpl, vars);
}

export function pickTemplate(languages) {
  if (languages.includes('typescript') || languages.includes('javascript')) {
    return 'workflow-ts.yml.tmpl';
  }
  if (languages.includes('python')) {
    return 'workflow-py.yml.tmpl';
  }
  return 'workflow.yml.tmpl';
}

// Map a pickTemplate() filename to the language key that `reviewPrompt`
// accepts. Keeps the mapping in one place so callers don't repeat the
// switch when computing the REVIEW_PROMPT token.
export function templateLanguage(tmplName) {
  if (tmplName === 'workflow-ts.yml.tmpl') return 'ts';
  if (tmplName === 'workflow-py.yml.tmpl') return 'py';
  return 'generic';
}
