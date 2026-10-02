import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { RELEASES, VERSION, compareVersions, releasesSince } from './changelog.ts';

test('the newest release notes are for the version in package.json', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  assert.equal(VERSION, pkg.version);
});

test('releases are listed newest first, each with a date and something to say', () => {
  for (const [i, release] of RELEASES.entries()) {
    assert.match(release.version, /^\d+\.\d+\.\d+$/);
    assert.match(release.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(release.title && release.changes.length, `${release.version} has no notes`);
    if (i > 0) {
      assert.ok(compareVersions(RELEASES[i - 1].version, release.version) > 0, `${release.version} is out of order`);
      assert.ok(RELEASES[i - 1].date >= release.date, `${release.version} is dated after a newer release`);
    }
  }
});

test('versions compare by number, not by spelling', () => {
  assert.ok(compareVersions('1.10.0', '1.9.3') > 0);
  assert.ok(compareVersions('1.2', '1.2.1') < 0);
  assert.equal(compareVersions('2.0.0', '2.0'), 0);
});

test('only the releases after the one last seen count as news', () => {
  assert.deepEqual(releasesSince(VERSION), []);
  assert.deepEqual(releasesSince('0.0.1'), RELEASES);
  assert.deepEqual(releasesSince(RELEASES[1].version), [RELEASES[0]]);
});
