import assert from 'node:assert/strict'
import test from 'node:test'

import { registerSkill } from '../lib/skill.js'

test('registers the bundled skill with a source string', async () => {
  let registered
  const ctx = {
    skills: {
      register: (skill) => {
        registered = skill
        return () => {}
      },
    },
  }

  const dispose = await registerSkill(ctx)
  assert.equal(typeof dispose, 'function')
  assert.equal(registered.name, 'ugreen-nas')
  assert.equal(registered.source, 'bundled')
  assert.equal(typeof registered.content, 'string')
  assert.match(registered.content, /ugreen_nas/)
})
