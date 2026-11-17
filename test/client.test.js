import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

test('client bundle registers the plugin detail login section', async () => {
  const code = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.match(code, /UGREENlink ID/)
  assert.match(code, /\/api\/ugreen-nas\/auth/)
  assert.match(code, /mode === 'linkid'/)
  let plugin
  const fakeReact = { createElement: () => null, useState: () => [], useEffect: () => {}, useRef: () => ({ current: false }), useCallback: (fn) => fn }
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(definition) {
          plugin = definition.factory((name) => (name === 'react' ? fakeReact : {}))
        },
      },
    },
    console,
  }
  vm.runInNewContext(code, sandbox)
  assert.equal(typeof plugin.apply, 'function')
  let registration
  const ctx = {
    slots: {
      inject(name, callback) {
        assert.equal(name, 'plugins.detail.section')
        callback()
      },
      register(options, component) {
        registration = { options, component }
        return () => {}
      },
    },
  }
  plugin.apply(ctx)
  assert.equal(registration.options.name, 'plugins.detail.section')
  assert.equal(registration.options.id, 'ugreen-nas-login')
  assert.equal(typeof registration.component, 'function')
})
