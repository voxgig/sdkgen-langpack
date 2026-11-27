import { cmp, Content, entityOps, fact } from '@voxgig/sdkgen'
import { KIT, getModelPath, nom } from '@voxgig/apidef'

const ReadmeHowto = cmp(function ReadmeHowto(props: any) {
  const { target, ctx$ } = props
  const { model } = ctx$

  const active = Object.values(getModelPath(model, `main.${KIT}.entity`) || {})
    .filter((e: any) => e.active !== false) as any[]
  const ns = (e: any) => e.name.charAt(0).toUpperCase() + e.name.slice(1)

  const loader = active.find((e: any) => entityOps(e).includes('load'))
  if (null != loader) {
    Content(`**Handle a missing record.** A \`load\` that finds nothing yields a
non-map value, so match on it:

\`\`\`lean
match (← ${ns(loader)}.load sdk m (← emptyMap)) with
| .map _ => IO.println "found"
| _ => IO.println "not found"
\`\`\`

`)
  }

  // The build phase writes the per-entity test data under `.sdk/test/entity/`.
  if (fact(model.main[KIT], 'build') && 0 < active.length) {
    const sdkrel = null != ctx$.sdkrelpath ? ctx$.sdkrelpath : fact(target, 'sdkrel')
    const seed = ('.' === sdkrel ? '' : sdkrel + '/') + '.sdk/test/entity/' +
      active[0].name + '/' + nom(active[0], 'Name') + 'TestData.json'

    Content(`**Test without a server.** \`Sdk.testSdk0\` takes seed data (the shape of the
generated test data) and answers operations from an in-memory store, so entity
behaviour can be exercised offline:

\`\`\`lean
let seed ← SdkJson.jsonRead (← IO.FS.readFile "${seed}")
let sdk ← Sdk.testSdk0 seed
\`\`\`

`)
  }
})

export { ReadmeHowto }
