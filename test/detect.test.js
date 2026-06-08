import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detect, buildDescriptionLine, _internal } from '../lib/detect.js';

async function makeRepo(files) {
  const dir = await mkdtemp(join(tmpdir(), 'clud-bug-detect-'));
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content);
  }
  return dir;
}

test('detect picks up Next.js + TypeScript from package.json + .tsx files', async () => {
  const dir = await makeRepo({
    'package.json': JSON.stringify({
      name: 'demo-app', description: 'a thing',
      dependencies: { next: '^15', react: '^19' },
      devDependencies: { typescript: '^5' },
    }),
    'src/page.tsx': 'export default function Page() {}',
  });
  try {
    const s = await detect(dir);
    assert.equal(s.name, 'demo-app');
    assert.equal(s.description, 'a thing');
    assert.ok(s.searchTerms.includes('nextjs'));
    assert.ok(s.searchTerms.includes('react'));
    assert.ok(s.languages.includes('typescript'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('detect handles a Python repo with pyproject.toml', async () => {
  const dir = await makeRepo({
    'pyproject.toml': `
[project]
name = "ingest"
description = "ingest pipeline"
dependencies = ["fastapi>=0.100", "pydantic"]
`,
    'app/main.py': 'print("hi")',
  });
  try {
    const s = await detect(dir);
    assert.equal(s.name, 'ingest');
    assert.ok(s.searchTerms.includes('fastapi'));
    assert.ok(s.searchTerms.includes('pydantic'));
    assert.equal(s.primaryLanguage, 'python');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('detect handles a Go repo via go.mod', async () => {
  const dir = await makeRepo({
    'go.mod': 'module github.com/foo/bar\n\ngo 1.22\n',
    'main.go': 'package main',
  });
  try {
    const s = await detect(dir);
    assert.equal(s.name, 'bar');
    assert.equal(s.primaryLanguage, 'go');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('detect falls back to README first paragraph for description', async () => {
  const dir = await makeRepo({
    'README.md': '# Project\n\nThis is a fairly long description sentence that describes the project in detail and exceeds the forty character minimum.\n',
  });
  try {
    const s = await detect(dir);
    assert.match(s.description, /fairly long description/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('detect returns empty signals for an empty repo without erroring', async () => {
  const dir = await makeRepo({ 'placeholder.txt': 'x' });
  try {
    const s = await detect(dir);
    assert.equal(s.languages.length, 0);
    assert.equal(s.searchTerms.length, 0);
    assert.equal(s.primaryLanguage, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('fileHistogram skips node_modules and dist', async () => {
  const dir = await makeRepo({
    'src/a.ts': '',
    'node_modules/foo/index.js': '',
    'dist/bundle.js': '',
  });
  try {
    const histo = await _internal.fileHistogram(dir);
    assert.equal(histo.typescript, 1);
    assert.equal(histo.javascript, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('buildDescriptionLine produces a usable sentence from full signals', () => {
  const line = buildDescriptionLine({
    name: 'foo',
    description: 'A test repo.',
    primaryLanguage: 'typescript',
    searchTerms: ['nextjs', 'react', 'typescript'],
  });
  assert.match(line, /foo/);
  assert.match(line, /A test repo/);
  assert.match(line, /typescript/);
  assert.match(line, /nextjs, react/);
});

test('buildDescriptionLine falls back gracefully with no signals', () => {
  const line = buildDescriptionLine({
    name: null, description: null, primaryLanguage: null, searchTerms: [],
  });
  assert.match(line, /unavailable/);
});

// v0.6.25 / issue #89 — `buildDescriptionLine` collapses multi-line
// descriptions to a single line. Without this, a multi-paragraph
// README first paragraph leaks literal `\n` into the rendered YAML's
// APPEND_SYSTEM_PROMPT, breaking YAML parsing on `clud-bug update`.
test('buildDescriptionLine collapses internal newlines + tabs to single spaces (issue #89)', () => {
  const line = buildDescriptionLine({
    name: 'demo',
    description: 'A multi-line\ndescription\n\nwith\ttabs and blanks',
    primaryLanguage: null,
    searchTerms: [],
  });
  assert.doesNotMatch(line, /\n/, 'must not contain literal newlines');
  assert.doesNotMatch(line, /\t/, 'must not contain literal tabs');
  assert.doesNotMatch(line, / {2}/, 'must not contain double-spaces (runs collapsed)');
  assert.match(line, /A multi-line description with tabs and blanks\./);
});

test('buildDescriptionLine adds trailing period iff missing (preserved across #89 fix)', () => {
  const withPeriod = buildDescriptionLine({
    name: null, description: 'Already punctuated.', primaryLanguage: null, searchTerms: [],
  });
  assert.match(withPeriod, /Already punctuated\.$/);

  const noPeriod = buildDescriptionLine({
    name: null, description: 'Needs one', primaryLanguage: null, searchTerms: [],
  });
  assert.match(noPeriod, /Needs one\.$/);
});
