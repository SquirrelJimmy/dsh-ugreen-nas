import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveRelease } from '../lib/release.js'

test('pinned release returns the six platform assets and checksum', async () => {
  const release = await resolveRelease({ versionPolicy: 'pinned' })
  assert.equal(release.version, '0.1.61')
  assert.equal(release.tag, 'v0.1.61')
  assert.equal(release.source, 'pinned')
  assert.equal(release.assets.length, 6)
  assert.equal(release.checksums['unc-v0.1.61-linux-amd64.tar.gz'], '81953945b310dbfa3f748c2fe7d1d4f5424754c967fd2dd5d377f72921eff8d5')
  assert.equal(release.skillsAsset, 'unc-skills-v0.1.61.zip')
})

test('pinned release rejects an unknown version instead of guessing a checksum', async () => {
  await assert.rejects(
    resolveRelease({ versionPolicy: 'pinned', pinnedVersion: '9.9.9' }),
    { code: 'UNSUPPORTED_VERSION' },
  )
})
