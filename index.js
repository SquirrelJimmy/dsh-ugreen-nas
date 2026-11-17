import { registerAuthRoute } from './lib/web-server.js'
import { registerSkill } from './lib/skill.js'
import { registerTools } from './lib/tools/index.js'
import { createRuntime } from './lib/state.js'

export const inject = ['tools', 'skills']

export async function apply(ctx, config) {
  const runtime = createRuntime({ config })
  const disposeTools = registerTools(ctx, runtime)
  const disposeAuthRoute = registerAuthRoute(ctx, runtime)

  let disposeSkill
  try {
    disposeSkill = await registerSkill(ctx)
  } catch (error) {
    ctx.logger?.warn?.(`dsh-ugreen-nas: failed to register embedded Skill: ${error.message}`)
  }

  const cleanup = () => {
    disposeAuthRoute()
    disposeSkill?.()
    disposeTools()
    runtime.dispose()
  }
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => cleanup)
  } else {
    ctx.on?.('dispose', cleanup)
  }
}
