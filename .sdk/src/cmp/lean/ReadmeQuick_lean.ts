import { cmp, Content, entityOps } from '@voxgig/sdkgen'
import { KIT, getModelPath } from '@voxgig/apidef'

import { leanClientOptions } from './utility_lean'

// A capitalised entity op namespace + a representative read op for the example.
function pickEntity(model: any): { ns: string, op: string } | null {
  const entity = getModelPath(model, `main.${KIT}.entity`)
  const ents = Object.values(entity || {}).filter((e: any) => e.active !== false)
  for (const e of ents as any[]) {
    const ops = entityOps(e)
    const op = ops.includes('list') ? 'list' : ops[0]
    if (op) {
      return { ns: e.name.charAt(0).toUpperCase() + e.name.slice(1), op }
    }
  }
  return null
}

const ReadmeQuick = cmp(function ReadmeQuick(props: any) {
  const { ctx$: { model } } = props
  const pick = pickEntity(model)
  const ns = pick ? pick.ns : 'Entity'
  const op = pick ? pick.op : 'list'

  Content(`Construct a client with \`Sdk.newSdk\` and call an entity op. Everything runs
in struct's \`SIO\` monad, so wrap your calls and \`.run\` them on a fresh \`mkCtx\`:

\`\`\`lean
import SdkClient

open VoxgigStruct

def main : IO Unit := do
  let ctx ← mkCtx
  (do
    let sdk ← Sdk.newSdk ${leanClientOptions(model)}
    let result ← ${ns}.${op} sdk (← emptyMap) (← emptyMap)
    IO.println s!"result: {← stringify result}"
  ).run ctx
\`\`\`

`)
})

export { ReadmeQuick }
