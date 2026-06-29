// Update notifier (rc.20) — the brew/npm/gh/vercel pattern: on an interactive
// `clud-bug` run, if a newer version is published, print a one-line nudge to
// upgrade. NEVER blocks the command: the notice is read from a local cache, and
// the cache is refreshed by a DETACHED background process (at most once a day).
// The notice therefore appears on the run AFTER a new release is detected — the
// standard, zero-latency update-notifier UX.

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CACHE_FILE = join(homedir(), '.cache', 'clud-bug', 'update-check.json');
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // once a day

/**
 * True if version `a` is newer than `b`, for clud-bug's `X.Y.Z` / `X.Y.Z-rc.N`
 * scheme. A stable build (no prerelease) ranks ABOVE any prerelease of the same
 * core (so `0.7.0` > `0.7.0-rc.20`). Pure.
 */
export function isNewerVersion(a: string, b: string): boolean {
  const parse = (v: string): number[] => {
    const [core = '', pre] = String(v).split('-');
    const nums = core.split('.').map((n) => Number(n) || 0);
    // No prerelease → Infinity so a stable sorts above any -rc.N of the same core.
    const preNum = pre ? Number((pre.match(/\d+/) || ['0'])[0]) : Infinity;
    return [...nums, preNum];
  };
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

interface UpdateCache {
  checkedAt?: number;
  latest?: string;
}

/**
 * Print an upgrade nudge if the cached latest version is newer than `current`,
 * and (if the cache is stale) kick off a detached background refresh. Best-effort
 * — any error is swallowed. Caller should gate on an interactive TTY.
 */
export async function maybeNotifyUpdate(
  current: string,
  opts: { channel?: string; now?: number; cacheFile?: string } = {},
): Promise<void> {
  const channel = opts.channel ?? 'next';
  const now = opts.now ?? Date.now();
  const cacheFile = opts.cacheFile ?? CACHE_FILE;
  try {
    let cache: UpdateCache = {};
    try {
      cache = JSON.parse(await readFile(cacheFile, 'utf8')) as UpdateCache;
    } catch {
      /* no/invalid cache — first run */
    }

    if (typeof cache.latest === 'string' && isNewerVersion(cache.latest, current)) {
      process.stderr.write(
        `\n  ⬆ clud-bug ${cache.latest} is available (you have ${current}).\n` +
          `    Run \`clud-bug update\` to refresh your kit. (max-mode hooks already auto-update.)\n\n`,
      );
    }

    if (!cache.checkedAt || now - cache.checkedAt > CHECK_INTERVAL_MS) {
      refreshInBackground(channel, now, cacheFile);
    }
  } catch {
    /* never throw — a version check must never break a command */
  }
}

/**
 * Spawn a detached, unref'd child that fetches the channel's current version
 * from the npm registry and writes the cache, then the parent exits immediately.
 * The registry's per-dist-tag endpoint returns just that manifest (small).
 */
function refreshInBackground(channel: string, now: number, cacheFile: string): void {
  const script = `
const https=require('https'),fs=require('fs'),path=require('path');
const cf=${JSON.stringify(cacheFile)};
https.get('https://registry.npmjs.org/clud-bug/'+${JSON.stringify(channel)},r=>{
  let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{
    const v=JSON.parse(d).version;
    if(v){fs.mkdirSync(path.dirname(cf),{recursive:true});fs.writeFileSync(cf,JSON.stringify({checkedAt:${now},latest:v}));}
  }catch(e){}});
}).on('error',()=>{});`;
  try {
    const child = spawn(process.execPath, ['-e', script], { detached: true, stdio: 'ignore' });
    child.unref();
  } catch {
    /* spawn failed — skip; the notice just won't refresh this run */
  }
}
