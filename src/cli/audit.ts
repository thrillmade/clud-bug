// CLI audit helpers — these shell out to git and walk the working tree.
//
// Split from lib/audit.js during the v0.7.0 TS migration. Pure helpers
// (durationToGitSince, renderAuditHeader) live in src/core/audit.ts so the
// App-side (clud-bug-app) can consume them without dragging child_process
// in. computeAuditFileSet stays CLI-only — it is only meaningful when run
// in a checked-out repo.

import { spawnSync } from 'node:child_process';
import { durationToGitSince } from '../core/audit.js';

export interface GitLinesOptions {
  // `cwd?: string | undefined` (vs `cwd?: string`) is required by
  // exactOptionalPropertyTypes: true — callers freely pass an inline
  // object that may have `cwd` typed as `string | undefined`.
  cwd?: string | undefined;
  allowFail?: boolean | undefined;
}

// Run a git command, return stdout lines split by \n. Throws on non-zero exit
// unless { allowFail: true }, in which case returns [].
// Note: under noUncheckedIndexedAccess: true, array element reads are typed
// `string | undefined`. The return type stays `string[]` (we filter falsy
// strings out), but callers indexing into the result must keep that in mind.
export function gitLines(args: string[], opts: GitLinesOptions = {}): string[] {
  const r = spawnSync('git', args, { encoding: 'utf8', cwd: opts.cwd || process.cwd() });
  if (r.status !== 0) {
    if (opts.allowFail) return [];
    // spawnSync with encoding:'utf8' makes stderr `string | null`; the null
    // path only happens when the child can't be spawned at all (a different
    // error path). When status is non-zero we have stderr.
    const stderr = (r.stderr ?? '').toString().trim();
    throw new Error(`git ${args.join(' ')} failed (${r.status}): ${stderr}`);
  }
  const stdout = (r.stdout ?? '').toString();
  return stdout.split('\n').filter(Boolean);
}

export interface AuditFileSetOptions {
  since?: string | null;
  changedIn?: string | null;
  scopes?: string[];
  cwd?: string;
}

// Returns the file set the audit should consider, in repo-relative paths.
// Filters: optional --since (git date), optional --changed-in (duration string),
// optional --scope globs (one or more, repeatable).
export function computeAuditFileSet({ since, changedIn, scopes = [], cwd }: AuditFileSetOptions = {}): string[] {
  const sinceArg = since || (changedIn ? durationToGitSince(changedIn) : null);

  let files: string[];
  if (sinceArg) {
    // Files touched in any commit within the window.
    files = [...new Set(gitLines(['log', `--since=${sinceArg}`, '--name-only', '--pretty=format:'], { cwd }))];
    // --diff-filter at the log level only excludes the delete commit; a file
    // that was modified (and emitted by --name-only) and *later* deleted will
    // still appear here. Intersect with the current tracked-file set so the
    // manifest only contains paths we can actually read.
    const tracked = new Set(gitLines(['ls-files'], { cwd }));
    files = files.filter((f) => tracked.has(f));
  } else {
    files = gitLines(['ls-files'], { cwd });
  }

  if (scopes.length) {
    const matchers = scopes.map(globToRegex);
    files = files.filter((f) => matchers.some((rx) => rx.test(f)));
  }

  // Skip vendor / build artifacts that bloat audits without adding signal.
  const skip = /(^|\/)(node_modules|dist|build|out|\.next|\.vercel|coverage|target|__pycache__)\//;
  return files.filter((f) => !skip.test(f)).sort();
}

// Minimal glob → RegExp. Supports **, *, ?. Anchors at both ends so that
// 'src/**/*.ts' matches 'src/lib/foo.ts' but not 'app/src/lib/foo.ts'.
function globToRegex(glob: string): RegExp {
  let rx = '';
  let i = 0;
  while (i < glob.length) {
    const ch = glob[i];
    if (ch === '*' && glob[i + 1] === '*') {
      // ** = any depth (including zero) of path segments
      rx += '.*';
      i += 2;
      // consume an optional trailing slash so 'src/**/*.ts' works cleanly
      if (glob[i] === '/') i++;
    } else if (ch === '*') {
      rx += '[^/]*';
      i++;
    } else if (ch === '?') {
      rx += '[^/]';
      i++;
    } else if (ch !== undefined && /[.+^$|()\[\]{}\\]/.test(ch)) {
      rx += '\\' + ch;
      i++;
    } else {
      rx += ch;
      i++;
    }
  }
  return new RegExp(`^${rx}$`);
}
