import assert from 'node:assert/strict'
import test from 'node:test'

import { assertCommandAllowed, inspectCommand } from '../lib/policy.js'

test('file ls is read-only and allowed', () => {
  const result = inspectCommand(['file', 'ls', '/volume1'])
  assert.equal(result.allowed, true)
  assert.equal(result.readOnly, true)
  assert.equal(result.requiresConfirm, false)
})

test('file rm requires explicit confirmation', () => {
  const result = inspectCommand(['file', 'rm', '/volume1/old.txt'])
  assert.equal(result.allowed, true)
  assert.equal(result.destructive, true)
  assert.throws(() => assertCommandAllowed(['file', 'rm', '/volume1/old.txt']), { code: 'CONFIRMATION_REQUIRED' })
  assert.doesNotThrow(() => assertCommandAllowed(['file', 'rm', '/volume1/old.txt'], { confirm: true }))
})

test('--yes requires confirmation and is not silently appended', () => {
  const result = inspectCommand(['docker', 'stop', 'container1', '--yes'])
  assert.equal(result.hasYes, true)
  assert.equal(result.requiresConfirm, true)
  assert.throws(() => assertCommandAllowed(['docker', 'stop', 'container1', '--yes']), { code: 'CONFIRMATION_REQUIRED' })
})

test('blocked command groups are rejected', () => {
  assert.throws(() => assertCommandAllowed(['plugin', 'install', 'workbuddy']), { code: 'COMMAND_NOT_ALLOWED' })
  assert.throws(() => assertCommandAllowed(['upgrade']), { code: 'COMMAND_NOT_ALLOWED' })
  assert.throws(() => assertCommandAllowed(['auth', 'login']), { code: 'COMMAND_NOT_ALLOWED' })
})

test('unknown groups are rejected', () => {
  assert.throws(() => assertCommandAllowed(['unknown', 'thing']), { code: 'COMMAND_NOT_ALLOWED' })
})

test('version and doctor remain read-only with writes disabled', () => {
  assert.doesNotThrow(() => assertCommandAllowed(['version', '--format', 'json'], { allowWrites: false }))
  assert.doesNotThrow(() => assertCommandAllowed(['doctor', '--format', 'json'], { allowWrites: false }))
})

test('nested tag and compose subcommands are classified by their actual operation', () => {
  const tagList = inspectCommand(['file', 'tag', 'list'])
  assert.equal(tagList.readOnly, true)
  assert.equal(tagList.requiresConfirm, false)

  const tagAdd = inspectCommand(['file', 'tag', 'add'])
  assert.equal(tagAdd.readOnly, false)
  assert.equal(tagAdd.requiresConfirm, true)
  assert.throws(() => assertCommandAllowed(['file', 'tag', 'add']), { code: 'CONFIRMATION_REQUIRED' })

  const composeLs = inspectCommand(['docker', 'compose', 'ls'])
  assert.equal(composeLs.readOnly, true)
  const composeUp = inspectCommand(['docker', 'compose', 'up'])
  assert.equal(composeUp.requiresConfirm, true)
  assert.throws(() => assertCommandAllowed(['docker', 'compose', 'up']), { code: 'CONFIRMATION_REQUIRED' })

  assert.equal(inspectCommand(['ctl', 'group', 'ls']).readOnly, true)
  assert.throws(() => assertCommandAllowed(['ctl', 'group', 'add-member']), { code: 'CONFIRMATION_REQUIRED' })
})
