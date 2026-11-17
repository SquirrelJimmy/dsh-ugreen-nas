import assert from 'node:assert/strict'
import test from 'node:test'

import { artifactName, detectPlatform, skillsArtifactName } from '../lib/platform.js'

test('maps macOS x64 and arm64 to official asset names', () => {
  assert.equal(detectPlatform('darwin', 'x64').platformName, 'darwin-amd64')
  assert.equal(detectPlatform('darwin', 'arm64').platformName, 'darwin-arm64')
  assert.equal(artifactName(detectPlatform('darwin', 'arm64'), '0.1.61'), 'unc-v0.1.61-darwin-arm64.tar.gz')
})

test('maps Linux x64 and arm64 to official asset names', () => {
  assert.equal(artifactName(detectPlatform('linux', 'x64'), '0.1.61'), 'unc-v0.1.61-linux-amd64.tar.gz')
  assert.equal(artifactName(detectPlatform('linux', 'arm64'), '0.1.61'), 'unc-v0.1.61-linux-arm64.tar.gz')
})

test('maps Windows to zip assets and exe name', () => {
  const platform = detectPlatform('win32', 'arm64')
  assert.equal(platform.binaryName, 'unc.exe')
  assert.equal(platform.isZip, true)
  assert.equal(artifactName(platform, 'v0.1.61'), 'unc-v0.1.61-windows-arm64.zip')
})

test('rejects unsupported platforms', () => {
  assert.throws(() => detectPlatform('freebsd', 'x64'), { code: 'UNSUPPORTED_PLATFORM' })
  assert.throws(() => detectPlatform('darwin', 'ia32'), { code: 'UNSUPPORTED_PLATFORM' })
})

test('builds the skills asset name', () => {
  assert.equal(skillsArtifactName('0.1.61'), 'unc-skills-v0.1.61.zip')
})
