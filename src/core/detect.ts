import { readFile, readdir, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';

// Lookup tables for the project-shape detectors. Each map is `as const` so
// downstream consumers can rely on the value types narrowing to the literal
// strings rather than `string` — `_internal.EXT_TO_LANG['.ts']` resolves to
// `'typescript'` for IDE navigation, not just `string`.
export const EXT_TO_LANG = {
  '.ts': 'typescript', '.tsx': 'typescript',
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.rb': 'ruby',
  '.java': 'java', '.kt': 'kotlin',
  '.swift': 'swift',
  '.php': 'php',
  '.cs': 'csharp',
  '.c': 'c', '.h': 'c',
  '.cpp': 'cpp', '.cc': 'cpp', '.hpp': 'cpp',
} as const satisfies Record<string, string>;

// Dependency name → search term hint passed to skills.sh.
// Only well-known frameworks; obscure packages get filtered out so the
// skills.sh query doesn't get drowned in noise.
export const DEP_TO_TERM = {
  'next': 'nextjs', 'react': 'react', 'vue': 'vue', 'svelte': 'svelte',
  '@angular/core': 'angular', 'solid-js': 'solid',
  'express': 'express', 'fastify': 'fastify', 'koa': 'koa', 'hono': 'hono',
  'prisma': 'prisma', '@prisma/client': 'prisma', 'drizzle-orm': 'drizzle',
  'mongoose': 'mongodb', 'mongodb': 'mongodb',
  'tailwindcss': 'tailwind',
  'vitest': 'vitest', 'jest': 'jest', 'playwright': 'playwright',
  '@playwright/test': 'playwright',
  'typescript': 'typescript',
} as const satisfies Record<string, string>;

export const PY_DEP_TO_TERM = {
  'django': 'django', 'flask': 'flask', 'fastapi': 'fastapi',
  'click': 'click', 'typer': 'typer',
  'pytest': 'pytest', 'sqlalchemy': 'sqlalchemy',
  'pydantic': 'pydantic', 'numpy': 'numpy', 'pandas': 'pandas',
} as const satisfies Record<string, string>;

// Result of running every detector + post-processing — the data shape callers
// (bin/clud-bug.js, lib/update.js) read from. `description` is nullable
// because the README fallback may not produce anything.
export interface DetectedSignals {
  name: string | null;
  description: string | null;
  languages: string[];
  histogram: Record<string, number>;
  searchTerms: string[];
  primaryLanguage: string | null;
}

// Per-detector intermediate type — what each manifest-reader returns before
// we aggregate. `languages` is the languages each manifest implies (e.g.
// package.json implies ['javascript']) so we can union them in detect().
interface DetectorResult {
  name: string | null;
  description: string | null;
  languages: string[];
  terms: string[];
}

interface PackageJson {
  name?: string;
  description?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

// #319 (§6.7 setup-time suite detection) — the placeholder every `npm init`
// writes. It declares nothing about the repository; a repo that never
// touched it has no test suite in any sense §6.7 cares about. Mirrors
// PKG_TEST_SCRIPT_PARSER in src/cli/hooks.ts, which applies the identical
// rule from the base ref at PUSH time — this copy is the working-tree-time
// twin, used only to SUGGEST a value during `clud-bug init`/`update`.
const NPM_INIT_TEST_PLACEHOLDER = /^echo\s+"Error:\s*no\s*test\s*specified"\s*&&\s*exit\s*1$/i;

/**
 * A real `package.json` `scripts.test`, or `null` if there is none (missing,
 * non-string, blank, or the `npm init` placeholder).
 *
 * READS THE WORKING TREE — correct for suggesting a value during `init`, but
 * this must NEVER be used to gate a push: §6.3 requires a gate's declared
 * state to come from the base ref, never the working tree, which is exactly
 * what the pre-push hook itself does (see `buildPrePushHookScript` in
 * src/cli/hooks.ts) instead of calling this function.
 */
export async function detectPackageTestScript(root: string): Promise<string | null> {
  const pkg = await readJsonSafe<PackageJson>(join(root, 'package.json'));
  const t = pkg?.scripts?.test;
  if (typeof t !== 'string') return null;
  const trimmed = t.trim();
  if (!trimmed || NPM_INIT_TEST_PLACEHOLDER.test(trimmed)) return null;
  return trimmed;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readJsonSafe<T = unknown>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

async function readTextSafe(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

async function detectFromPackageJson(root: string): Promise<DetectorResult | null> {
  const pkg = await readJsonSafe<PackageJson>(join(root, 'package.json'));
  if (!pkg) return null;
  const deps: Record<string, string> = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const terms = new Set<string>();
  for (const dep of Object.keys(deps)) {
    const term = (DEP_TO_TERM as Record<string, string>)[dep];
    if (term) terms.add(term);
  }
  return {
    name: pkg.name ?? null,
    description: pkg.description || null,
    languages: ['javascript', ...(deps.typescript || pkg.devDependencies?.typescript ? ['typescript'] : [])],
    terms: [...terms],
  };
}

async function detectFromPyproject(root: string): Promise<DetectorResult | null> {
  const text = await readTextSafe(join(root, 'pyproject.toml'));
  if (!text) return null;
  const terms = new Set<string>();
  for (const [dep, term] of Object.entries(PY_DEP_TO_TERM)) {
    // crude but adequate match — full TOML parse would be overkill for the
    // dependency-name lookup we actually need
    if (new RegExp(`["']${dep}[><=~ "']`, 'i').test(text)) terms.add(term);
  }
  const nameMatch = text.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
  const descMatch = text.match(/^\s*description\s*=\s*["']([^"']+)["']/m);
  return {
    name: nameMatch?.[1] ?? null,
    description: descMatch?.[1] ?? null,
    languages: ['python'],
    terms: [...terms],
  };
}

async function detectFromRequirements(root: string): Promise<DetectorResult | null> {
  const text = await readTextSafe(join(root, 'requirements.txt'));
  if (!text) return null;
  const terms = new Set<string>();
  for (const line of text.split('\n')) {
    const dep = (line.split(/[<>=~ #]/)[0] ?? '').trim().toLowerCase();
    const term = (PY_DEP_TO_TERM as Record<string, string>)[dep];
    if (term) terms.add(term);
  }
  return { name: null, description: null, languages: ['python'], terms: [...terms] };
}

async function detectFromGoMod(root: string): Promise<DetectorResult | null> {
  const text = await readTextSafe(join(root, 'go.mod'));
  if (!text) return null;
  const moduleMatch = text.match(/^module\s+(\S+)/m);
  return {
    name: moduleMatch?.[1]?.split('/').pop() ?? null,
    description: null,
    languages: ['go'],
    terms: [],
  };
}

async function detectFromCargo(root: string): Promise<DetectorResult | null> {
  const text = await readTextSafe(join(root, 'Cargo.toml'));
  if (!text) return null;
  const nameMatch = text.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
  const descMatch = text.match(/^\s*description\s*=\s*["']([^"']+)["']/m);
  return {
    name: nameMatch?.[1] ?? null,
    description: descMatch?.[1] ?? null,
    languages: ['rust'],
    terms: [],
  };
}

async function detectFromGemfile(root: string): Promise<DetectorResult | null> {
  const text = await readTextSafe(join(root, 'Gemfile'));
  if (!text) return null;
  return { name: null, description: null, languages: ['ruby'], terms: [] };
}

async function fileHistogram(root: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 3) return;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' ||
          entry.name === 'dist' || entry.name === 'build' ||
          entry.name === '__pycache__' || entry.name === 'target') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
      } else {
        const lang = (EXT_TO_LANG as Record<string, string>)[extname(entry.name)];
        if (lang) counts[lang] = (counts[lang] || 0) + 1;
      }
    }
  }
  await walk(root, 0);
  return counts;
}

function firstParagraph(readme: string | null): string | null {
  if (!readme) return null;
  const lines = readme.split('\n').slice(0, 200);
  const paragraphs = lines.join('\n').split(/\n\s*\n/);
  for (const p of paragraphs) {
    const cleaned = p.replace(/^#+\s*/, '').replace(/[*_`]/g, '').trim();
    if (cleaned.length > 40) return cleaned.slice(0, 500);
  }
  return null;
}

export async function detect(root: string): Promise<DetectedSignals> {
  const detectors = [
    detectFromPackageJson, detectFromPyproject, detectFromRequirements,
    detectFromGoMod, detectFromCargo, detectFromGemfile,
  ];
  const results = (await Promise.all(detectors.map(d => d(root)))).filter(
    (r): r is DetectorResult => r !== null,
  );
  const histogram = await fileHistogram(root);
  const readme = await readTextSafe(join(root, 'README.md'))
    || await readTextSafe(join(root, 'README'));

  const languages = new Set<string>();
  const terms = new Set<string>();
  let name: string | null = null;
  let description: string | null = null;
  for (const r of results) {
    for (const lang of r.languages) languages.add(lang);
    for (const term of r.terms) terms.add(term);
    if (!name && r.name) name = r.name;
    if (!description && r.description) description = r.description;
  }
  for (const lang of Object.keys(histogram)) languages.add(lang);
  if (!description) description = firstParagraph(readme);

  // Prefer the language with the most files when picking a primary
  const sortedLangs = [...languages].sort((a, b) => (histogram[b] || 0) - (histogram[a] || 0));

  return {
    name,
    description,
    languages: sortedLangs,
    histogram,
    searchTerms: [...new Set([...terms, ...sortedLangs.slice(0, 2)])],
    primaryLanguage: sortedLangs[0] ?? null,
  };
}

// Input shape for buildDescriptionLine — a subset of DetectedSignals. We
// don't reuse DetectedSignals directly because the callers (templates,
// LLM-flow tests) often hand-build a subset rather than running detect().
export interface DescriptionLineSignals {
  name?: string | null;
  description?: string | null;
  primaryLanguage?: string | null;
  searchTerms?: string[];
}

export function buildDescriptionLine(signals: DescriptionLineSignals): string {
  const parts: string[] = [];
  if (signals.name) parts.push(`This project is "${signals.name}".`);
  if (signals.description) {
    // v0.6.25 / issue #89: when signals.description comes from a
    // README first paragraph or similar multi-paragraph source, the
    // raw `\n` characters survive into the rendered YAML's
    // APPEND_SYSTEM_PROMPT value. The renderer's indent-aware
    // substitution preserves layout but a literal `\n` inside a YAML
    // double-quoted string is interpreted as a newline, breaking
    // the YAML. Collapse any whitespace run (including newlines + tabs)
    // to a single space before further processing.
    const desc = signals.description.replace(/\s+/g, ' ').trim();
    parts.push(/[.!?]$/.test(desc) ? desc : `${desc}.`);
  }
  if (signals.primaryLanguage) {
    const frameworks = [...new Set(signals.searchTerms || [])].filter((t) =>
      !['typescript', 'javascript', 'python', 'go', 'rust', 'ruby'].includes(t));
    const frameworkPart = frameworks.length ? ` using ${frameworks.join(', ')}` : '';
    parts.push(`It's primarily ${signals.primaryLanguage}${frameworkPart}.`);
  }
  if (parts.length === 0) return 'Project context unavailable — review on the merits of the diff alone.';
  return parts.join(' ');
}

// Architect's anti-pattern fix (Phase 2): the JS source used a single
// `export const _internal = { … }` namespace as a test seam. The TS port
// promotes the table exports (EXT_TO_LANG, DEP_TO_TERM, PY_DEP_TO_TERM)
// to direct top-level exports, and exposes the two helper functions
// fileHistogram + firstParagraph as direct named exports too. Tests now
// import each symbol by name. No `_internal` re-export — that pattern is
// gone.
export { fileHistogram, firstParagraph };
