// Local helper: re-render templates/workflow*.yml.tmpl into .ci-rendered/,
// the same way .github/workflows/ci.yml's actionlint job does. Kept as a
// script so the rendered files a reviewer lints locally are byte-identical
// to the ones CI lints.
//
//   npm run build && node scripts/render-ci.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { renderFile, templateLanguage } = await import(`${ROOT}/dist/core/render.js`);
const { reviewPrompt } = await import(`${ROOT}/dist/core/prompts.js`);

await mkdir(resolve(ROOT, '.ci-rendered'), { recursive: true });
for (const name of ['workflow.yml.tmpl', 'workflow-ts.yml.tmpl', 'workflow-py.yml.tmpl']) {
  const out = await renderFile(resolve(ROOT, 'templates', name), {
    REVIEW_PROMPT: reviewPrompt({
      projectDescription: 'A test project.',
      language: templateLanguage(name),
    }),
  });
  const dest = resolve(ROOT, '.ci-rendered', basename(name).replace(/\.tmpl$/, ''));
  await writeFile(dest, out);
  console.log(`rendered ${dest}`);
}
