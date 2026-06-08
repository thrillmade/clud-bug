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
//
// IMPORTANT (v0.7.0 TS migration): the JS source lived at lib/render.js,
// so `join(__dirname, '..', 'package.json')` reached the package root
// from one level up. The TS port compiles to dist/core/render.js, which
// is TWO levels deep (dist/core/) — so we walk up TWO levels to find
// package.json. Without this adjustment, module-load would throw at
// runtime with "ENOENT dist/package.json". Verify on rebuild via:
//   node -e "import('./dist/core/render.js').then(m => console.log(m.DEFAULTS.CLUD_BUG_VERSION))"
const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_VERSION: string = (
  JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8')) as { version: string }
).version;

// Public shape of the DEFAULTS map. Tests assert presence of CCA_VERSION
// and CLUD_BUG_VERSION; REVIEW_SCHEMA is the serialized schema string the
// templates inject via the {{REVIEW_SCHEMA}} placeholder.
export interface RenderDefaults {
  CCA_VERSION: string;
  CLUD_BUG_VERSION: string;
  REVIEW_SCHEMA: string;
}

// Default values for substitution tokens that every template uses.
// Callers can override per-render by passing the same key in `vars`.
//
// CCA_VERSION pins `anthropics/claude-code-action` to a specific tag in
// every shipped workflow. Without this, templates resolved `@v1` (the
// floating major), so upstream changes could silently land in installed
// workflows mid-cycle. Bumping the pin requires a clud-bug release, which
// makes the upgrade visible + lets users opt out by pinning a different
// version in their own forked workflow.
export const DEFAULTS: RenderDefaults = {
  CCA_VERSION: 'v1.0.133',
  CLUD_BUG_VERSION: PKG_VERSION,
  REVIEW_SCHEMA: serializedReviewSchema(),
};

// Caller-supplied substitution vars: any extra placeholders the template
// uses (REVIEW_PROMPT, PROJECT_DESCRIPTION, etc.). Values may be strings,
// numbers, or anything String()-coercible. We accept a wider unknown type
// because the JS callers freely pass numbers, arrays, etc., and the
// String(value) coercion below handles them uniformly.
export type RenderVars = Partial<RenderDefaults> & Record<string, unknown>;

// Multi-line value substitution preserves YAML/Markdown indentation by
// applying the placeholder line's leading whitespace to every
// continuation line. Single-line values pass through unchanged so
// existing tokens (CCA_VERSION, PROJECT_DESCRIPTION) keep current behavior.
export function render(template: string, vars: RenderVars): string {
  const merged: Record<string, unknown> = { ...DEFAULTS, ...vars };
  return template.replace(PLACEHOLDER_RE, (_match, key: string, offset: number) => {
    if (!(key in merged)) {
      throw new Error(`Missing template variable: ${key}`);
    }
    const value = String(merged[key]);
    if (!value.includes('\n')) {
      return value;
    }
    const lineStart = template.lastIndexOf('\n', offset - 1) + 1;
    const leadingWhitespaceMatch = template.slice(lineStart, offset).match(/^(\s*)/);
    const indent = leadingWhitespaceMatch ? (leadingWhitespaceMatch[1] ?? '') : '';
    return value
      .split('\n')
      .map((line, i) => (i === 0 || line === '' ? line : indent + line))
      .join('\n');
  });
}

export async function renderFile(path: string, vars: RenderVars): Promise<string> {
  const tmpl = await readFile(path, 'utf8');
  return render(tmpl, vars);
}

export function pickTemplate(languages: string[]): string {
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
export type TemplateLanguage = 'ts' | 'py' | 'generic';

export function templateLanguage(tmplName: string): TemplateLanguage {
  if (tmplName === 'workflow-ts.yml.tmpl') return 'ts';
  if (tmplName === 'workflow-py.yml.tmpl') return 'py';
  return 'generic';
}
