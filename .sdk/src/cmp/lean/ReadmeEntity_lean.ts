import { cmp, Content, entityOps, fact } from '@voxgig/sdkgen'
import { KIT, getModelPath } from '@voxgig/apidef'

// One section per active entity: its op namespace and the calls it supports.
const ReadmeEntity = cmp(function ReadmeEntity(props: any) {
  const { ctx$: { model } } = props
  const entities = Object.values(getModelPath(model, `main.${KIT}.entity`) || {})
    .filter((e: any) => e.active !== false && 0 < entityOps(e).length) as any[]
  if (0 === entities.length) return

  Content(`

## Entities

`)

  for (const entity of entities) {
    const ns = entity.name.charAt(0).toUpperCase() + entity.name.slice(1)
    let rows = ''
    for (const op of entityOps(entity)) {
      const call =
        'create' === op ? `${ns}.create sdk data (← emptyMap)`
          : 'update' === op || 'patch' === op ? `${ns}.${op} sdk match data (← emptyMap)`
            : `${ns}.${op} sdk match (← emptyMap)`
      rows += `| \`${op}\` | \`${call}\` |\n`
    }

    const desc = fact(entity, 'desc').inline
    Content(`### ${ns}

${'' === desc ? '' : desc + '\n\n'}Operations are in the \`${ns}\` namespace; each takes the client first
and per-call options last.

| Op | Call |
| --- | --- |
${rows}
`)
  }
})

export { ReadmeEntity }
