
import { cmp, Content, pickExampleEntity } from '@voxgig/sdkgen'

import { KIT, getModelPath } from '@voxgig/apidef'

import { hsTestCall, hsVarName, pkgName } from './utility_haskell'


const ReadmeExplanation = cmp(function ReadmeExplanation(props: any) {
  const { target, ctx$: { model } } = props

  Content(`### Data as struct Values

The Haskell SDK models every API record as the dynamic \`Value\` type (from
the vendored \`VoxgigStruct\` module) rather than bespoke Haskell records.
This mirrors the dynamic nature of the API and keeps the SDK flexible: code
that works with \`Value\` needs no new datatypes when the API schema changes.

Build request maps with \`jo [(key, value)]\` and read fields back with
\`getp value "field"\`; scalars are the \`VStr\` / \`VNum\` / \`VBool\`
constructors, and \`VNoval\` stands for an absent property.

### Module structure

\`\`\`
${target.name}/
├── src/
│   ├── VoxgigStruct.hs   -- vendored dependency-free struct library (Value)
│   ├── Vregex.hs         -- vendored regex support
│   ├── SdkTypes.hs       -- core types (Client, Entity, Feature)
│   ├── SdkHelpers.hs     -- helper functions (jo, getp, ...)
│   ├── SdkRuntime.hs     -- the generic operation pipeline
│   ├── SdkFeatures.hs    -- built-in features + makeEntity
│   ├── SdkConfig.hs      -- generated API configuration + feature factory
│   └── SdkClient.hs      -- generated public client (newSdk, entity accessors)
├── test/                 -- test suites
├── Makefile              -- stock-GHC build/test (no third-party deps)
└── ${pkgName(model)}.cabal      -- package manifest (for Hackage)
\`\`\`

The public module (\`SdkClient\`) exports the SDK constructors (\`newSdk\`,
\`testSdk\`) and one accessor per entity. Import \`VoxgigStruct\` for the
\`Value\` constructors and \`SdkHelpers\` for \`jo\` / \`getp\`.

`)

  // sdkgen's explanation writes this section only for its bundled languages.
  const { entity: ex, primaryOp } =
    pickExampleEntity(getModelPath(model, `main.${KIT}.entity`) || {})
  if (null != ex && null != primaryOp) {
    const eOp = 'e' + primaryOp.charAt(0).toUpperCase() + primaryOp.slice(1)
    Content(`### Entity state

Entity instances are stateful. After a successful \`${eOp}\`, the entity
stores the returned data and match criteria internally.

\`\`\`haskell
  ent <- Sdk.${hsVarName(ex.name)} sdk VNoval
  arg <- ${hsTestCall(ex, primaryOp, '  ').argExpr}
  ctrl <- emptyMap
  _ <- Sdk.${eOp} ent arg ctrl
  -- eDataGet ent now returns the ${ex.name} data from the last ${eOp}
\`\`\`

Call \`eMake\` to create a fresh instance with the same configuration
but no stored state.

`)
  }
})


export {
  ReadmeExplanation
}
