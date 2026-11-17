import assert from 'node:assert/strict'
import test from 'node:test'

import { parseChecksums } from '../lib/download.js'

test('parses GNU and asterisk checksum lines', () => {
  const checksums = parseChecksums([
    '81953945b310dbfa3f748c2fe7d1d4f5424754c967fd2dd5d377f72921eff8d5  unc-v0.1.61-linux-amd64.tar.gz',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa *unc-skills-v0.1.61.zip',
    'not a checksum line',
  ].join('\n'))
  assert.equal(checksums.get('unc-v0.1.61-linux-amd64.tar.gz'), '81953945b310dbfa3f748c2fe7d1d4f5424754c967fd2dd5d377f72921eff8d5')
  assert.equal(checksums.get('unc-skills-v0.1.61.zip'), 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
  assert.equal(checksums.size, 2)
})
