import { cmp, Content, introOps } from '@voxgig/sdkgen'
import { KIT, getModelPath } from '@voxgig/apidef'

const ReadmeIntroBody = cmp(function ReadmeIntroBody(props: any) {
  const { target, ctx$: { model } } = props

  const entity = getModelPath(model, `main.${KIT}.entity`)
  const verbs = introOps(model).map((o) => '`' + o + '`').join(', ')
  const lead = !Object.values(entity || {}).some((e: any) => e.active !== false) ?
    'Every operation' : 'The API is surfaced as capitalised Entities' +
    ('' === verbs ? '' : ` with a small, uniform\nverb set (${verbs})`) + '; every operation'

  Content(`The ${target.title} SDK for the ${model.Name} API — an entity-oriented client
for Lean 4. ${lead} is
driven by the embedded config through the dependency-free vendored voxgig
\`Value\` struct model, and runs in struct's \`SIO\` monad.

`)
})

export { ReadmeIntroBody }
