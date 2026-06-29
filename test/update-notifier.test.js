// rc.20 — the update notifier (brew/gh/vercel pattern).

import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { isNewerVersion, maybeNotifyUpdate } from '../src/cli/update-notifier.js';

describe('isNewerVersion', () => {
  it('orders rc versions and ranks a stable build above a prerelease', () => {
    expect(isNewerVersion('0.7.0-rc.20', '0.7.0-rc.19')).toBe(true);
    expect(isNewerVersion('0.7.0-rc.19', '0.7.0-rc.20')).toBe(false);
    expect(isNewerVersion('0.7.0', '0.7.0-rc.20')).toBe(true); // stable > prerelease
    expect(isNewerVersion('0.8.0-rc.1', '0.7.0-rc.99')).toBe(true);
    expect(isNewerVersion('0.7.0-rc.19', '0.7.0-rc.19')).toBe(false);
    expect(isNewerVersion('0.7.1', '0.7.0')).toBe(true);
  });
});

describe('maybeNotifyUpdate', () => {
  // A cache stamped at `now` is fresh → no background refresh is spawned, so
  // these tests exercise only the notice logic (no network, no child process).
  async function freshCache(latest, now) {
    const dir = await mkdtemp(join(tmpdir(), 'cb-notif-'));
    const cacheFile = join(dir, 'update-check.json');
    await writeFile(cacheFile, JSON.stringify({ checkedAt: now, latest }));
    return cacheFile;
  }
  function captureStderr() {
    return vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  }

  it('prints a nudge when the cached latest is newer', async () => {
    const now = 1_000_000;
    const cacheFile = await freshCache('0.7.0-rc.20', now);
    const spy = captureStderr();
    await maybeNotifyUpdate('0.7.0-rc.19', { cacheFile, now });
    const out = spy.mock.calls.map((c) => c[0]).join('');
    spy.mockRestore();
    expect(out).toMatch(/clud-bug 0\.7\.0-rc\.20 is available/);
    expect(out).toMatch(/clud-bug update/);
  });

  it('is silent when the current version is already the latest', async () => {
    const now = 1_000_000;
    const cacheFile = await freshCache('0.7.0-rc.19', now);
    const spy = captureStderr();
    await maybeNotifyUpdate('0.7.0-rc.19', { cacheFile, now });
    const out = spy.mock.calls.map((c) => c[0]).join('');
    spy.mockRestore();
    expect(out).not.toMatch(/is available/);
  });

  it('never throws on an unreadable cache (and returns undefined)', async () => {
    // fresh-enough `now` is irrelevant; a missing file just means no notice.
    const spy = captureStderr();
    await expect(
      maybeNotifyUpdate('0.7.0-rc.19', { cacheFile: join(tmpdir(), 'cb-does-not-exist', 'x.json'), now: 1 }),
    ).resolves.toBeUndefined();
    spy.mockRestore();
  });
});
