import { readFile } from 'node:fs/promises'

export async function registerSkill(ctx) {
  const content = await readFile(new URL('../skills/ugreen-nas/SKILL.md', import.meta.url), 'utf8')
  return ctx.skills.register({
    name: 'ugreen-nas',
    description: 'Use the official UGreen NAS unc CLI through the dsh-ugreen-nas plugin.',
    whenToUse: 'Use for all UGreen NAS tasks in DSH; this is the primary user-facing entry and should be preferred over the raw ugreen-nas-cli skill.',
    source: 'bundled',
    content,
  })
}
