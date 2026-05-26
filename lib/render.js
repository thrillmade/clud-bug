import { readFile } from 'node:fs/promises';

const PLACEHOLDER_RE = /\{\{([A-Z_]+)\}\}/g;

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
};

export function render(template, vars) {
  const merged = { ...DEFAULTS, ...vars };
  return template.replace(PLACEHOLDER_RE, (match, key) => {
    if (!(key in merged)) {
      throw new Error(`Missing template variable: ${key}`);
    }
    return merged[key];
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
