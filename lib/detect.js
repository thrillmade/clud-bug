import { readFile, readdir, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';

const EXT_TO_LANG = {
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
};

// Dependency name → search term hint passed to skills.sh.
// Only well-known frameworks; obscure packages get filtered out so the
// skills.sh query doesn't get drowned in noise.
const DEP_TO_TERM = {
  'next': 'nextjs', 'react': 'react', 'vue': 'vue', 'svelte': 'svelte',
  '@angular/core': 'angular', 'solid-js': 'solid',
  'express': 'express', 'fastify': 'fastify', 'koa': 'koa', 'hono': 'hono',
  'prisma': 'prisma', '@prisma/client': 'prisma', 'drizzle-orm': 'drizzle',
  'mongoose': 'mongodb', 'mongodb': 'mongodb',
  'tailwindcss': 'tailwind',
  'vitest': 'vitest', 'jest': 'jest', 'playwright': 'playwright',
  '@playwright/test': 'playwright',
  'typescript': 'typescript',
};

const PY_DEP_TO_TERM = {
  'django': 'django', 'flask': 'flask', 'fastapi': 'fastapi',
  'click': 'click', 'typer': 'typer',
  'pytest': 'pytest', 'sqlalchemy': 'sqlalchemy',
  'pydantic': 'pydantic', 'numpy': 'numpy', 'pandas': 'pandas',
};

async function fileExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readJsonSafe(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

async function readTextSafe(path) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

async function detectFromPackageJson(root) {
  const pkg = await readJsonSafe(join(root, 'package.json'));
  if (!pkg) return null;
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const terms = new Set();
  for (const dep of Object.keys(deps)) {
    if (DEP_TO_TERM[dep]) terms.add(DEP_TO_TERM[dep]);
  }
  return {
    name: pkg.name,
    description: pkg.description || null,
    languages: ['javascript', ...(deps.typescript || pkg.devDependencies?.typescript ? ['typescript'] : [])],
    terms: [...terms],
  };
}

async function detectFromPyproject(root) {
  const text = await readTextSafe(join(root, 'pyproject.toml'));
  if (!text) return null;
  const terms = new Set();
  for (const [dep, term] of Object.entries(PY_DEP_TO_TERM)) {
    // crude but adequate match — full TOML parse would be overkill for the
    // dependency-name lookup we actually need
    if (new RegExp(`["']${dep}[><=~ "']`, 'i').test(text)) terms.add(term);
  }
  const nameMatch = text.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
  const descMatch = text.match(/^\s*description\s*=\s*["']([^"']+)["']/m);
  return {
    name: nameMatch?.[1] || null,
    description: descMatch?.[1] || null,
    languages: ['python'],
    terms: [...terms],
  };
}

async function detectFromRequirements(root) {
  const text = await readTextSafe(join(root, 'requirements.txt'));
  if (!text) return null;
  const terms = new Set();
  for (const line of text.split('\n')) {
    const dep = line.split(/[<>=~ #]/)[0].trim().toLowerCase();
    if (PY_DEP_TO_TERM[dep]) terms.add(PY_DEP_TO_TERM[dep]);
  }
  return { name: null, description: null, languages: ['python'], terms: [...terms] };
}

async function detectFromGoMod(root) {
  const text = await readTextSafe(join(root, 'go.mod'));
  if (!text) return null;
  const moduleMatch = text.match(/^module\s+(\S+)/m);
  return {
    name: moduleMatch?.[1]?.split('/').pop() || null,
    description: null,
    languages: ['go'],
    terms: [],
  };
}

async function detectFromCargo(root) {
  const text = await readTextSafe(join(root, 'Cargo.toml'));
  if (!text) return null;
  const nameMatch = text.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
  const descMatch = text.match(/^\s*description\s*=\s*["']([^"']+)["']/m);
  return {
    name: nameMatch?.[1] || null,
    description: descMatch?.[1] || null,
    languages: ['rust'],
    terms: [],
  };
}

async function detectFromGemfile(root) {
  const text = await readTextSafe(join(root, 'Gemfile'));
  if (!text) return null;
  return { name: null, description: null, languages: ['ruby'], terms: [] };
}

async function fileHistogram(root) {
  const counts = {};
  async function walk(dir, depth) {
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
        const lang = EXT_TO_LANG[extname(entry.name)];
        if (lang) counts[lang] = (counts[lang] || 0) + 1;
      }
    }
  }
  await walk(root, 0);
  return counts;
}

function firstParagraph(readme) {
  if (!readme) return null;
  const lines = readme.split('\n').slice(0, 200);
  const paragraphs = lines.join('\n').split(/\n\s*\n/);
  for (const p of paragraphs) {
    const cleaned = p.replace(/^#+\s*/, '').replace(/[*_`]/g, '').trim();
    if (cleaned.length > 40) return cleaned.slice(0, 500);
  }
  return null;
}

export async function detect(root) {
  const detectors = [
    detectFromPackageJson, detectFromPyproject, detectFromRequirements,
    detectFromGoMod, detectFromCargo, detectFromGemfile,
  ];
  const results = (await Promise.all(detectors.map(d => d(root)))).filter(Boolean);
  const histogram = await fileHistogram(root);
  const readme = await readTextSafe(join(root, 'README.md'))
    || await readTextSafe(join(root, 'README'));

  const languages = new Set();
  const terms = new Set();
  let name = null;
  let description = null;
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
    primaryLanguage: sortedLangs[0] || null,
  };
}

export function buildDescriptionLine(signals) {
  const parts = [];
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
    const frameworks = [...new Set(signals.searchTerms)].filter(t =>
      !['typescript', 'javascript', 'python', 'go', 'rust', 'ruby'].includes(t));
    const frameworkPart = frameworks.length ? ` using ${frameworks.join(', ')}` : '';
    parts.push(`It's primarily ${signals.primaryLanguage}${frameworkPart}.`);
  }
  if (parts.length === 0) return 'Project context unavailable — review on the merits of the diff alone.';
  return parts.join(' ');
}

// Test seam: allow tests to inject the EXT_TO_LANG and DEP_TO_TERM tables
export const _internal = { EXT_TO_LANG, DEP_TO_TERM, PY_DEP_TO_TERM, fileHistogram, firstParagraph };
