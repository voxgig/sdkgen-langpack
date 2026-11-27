import { cmp, Content } from '@voxgig/sdkgen'

import { leanOptionRows } from './utility_lean'

const ReadmeModel = cmp(function ReadmeModel(props: any) {
  const { ctx$: { model } } = props

  Content(`Every value crossing the SDK boundary — options, request payloads,
responses and results — is a vendored voxgig \`Value\` (see \`VoxgigStruct.lean\`):
a JSON-shaped, heap-backed node. Operations run in struct's \`SIO\` monad
(\`ReaderT Ctx IO\`), so a single \`mkCtx\` is threaded through a run:

\`\`\`lean
let ctx ← mkCtx
(do
  let sdk ← Sdk.newSdk (← emptyMap)
  ...
).run ctx
\`\`\`

Build values with \`newMap\` / \`newList\`, read them with \`getprop\` / \`getpath\`,
and render them with \`stringify\` (debug) or \`jsonify\` (strict JSON).

### Client options

\`Sdk.newSdk\` takes its options as a \`Value\` map:

| Option | Type | Description |
| --- | --- | --- |
${leanOptionRows(model)}
`)
})

export { ReadmeModel }
