import { cmp, Content } from '@voxgig/sdkgen'

import { leanClientOptions } from './utility_lean'

// The Lean stanza of the top-level (multi-language) README quick start.
const ReadmeTopQuick = cmp(function ReadmeTopQuick(props: any) {
  const { target, ctx$: { model } } = props
  Content(`\`\`\`lean
import SdkClient
open VoxgigStruct

def main : IO Unit := do
  let ctx ← mkCtx
  (do
    let sdk ← Sdk.newSdk ${leanClientOptions(model)}
    IO.println s!"client ready"
  ).run ctx
\`\`\`

Build it with \`cd ${target.name} && lake build\`.

`)
})

export { ReadmeTopQuick }
