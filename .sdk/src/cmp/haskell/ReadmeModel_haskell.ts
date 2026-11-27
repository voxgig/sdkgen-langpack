
import { cmp, each, Content, fact, introOps, entityOps, entityPath } from '@voxgig/sdkgen'

import {
  KIT,
  getModelPath,
} from '@voxgig/apidef'

import { hsOptionRows, hsVarName } from './utility_haskell'


const ReadmeModel = cmp(function ReadmeModel(props: any) {
  const { target, ctx$: { model } } = props

  const entity = getModelPath(model, `main.${KIT}.entity`)
  const entityList = each(entity).filter((e: any) => e.active !== false)

  // Model-driven op rows for the shared entity record interface: emit a row
  // only for operations at least one active entity actually exposes.
  const opUnion = new Set<string>(introOps(model))
  const sameOps = fact(model.main[KIT], 'sharedOps')
  const opRowDefs: Record<string, string> = {
    load: '| `eLoad` | `Value -> Value -> IO Entity` | Load a single entity by match criteria. Resolves to the entity. Raises on error. |',
    list: '| `eList` | `Value -> Value -> IO [Entity]` | List entities matching the criteria. Resolves to one entity per record. Raises on error. |',
    create: '| `eCreate` | `Value -> Value -> IO Entity` | Create a new entity. Resolves to the entity. Raises on error. |',
    update: '| `eUpdate` | `Value -> Value -> IO Entity` | Update an existing entity. Resolves to the entity. Raises on error. |',
    patch: '| `ePatch` | `Value -> Value -> IO Entity` | Change part of an existing entity. Resolves to the entity. Raises on error. |',
    remove: '| `eRemove` | `Value -> Value -> IO Entity` | Remove an entity. Resolves to the entity, marked as deleted. Raises on error. |',
  }
  const opRows = ['load', 'list', 'create', 'update', 'patch', 'remove']
    .filter((o) => opUnion.has(o)).map((o) => opRowDefs[o] + '\n').join('')

  Content(`### Client constructors

\`\`\`haskell
import qualified SdkClient as Sdk
import VoxgigStruct (Value (..))
import SdkHelpers (jo)

makeClient :: IO Sdk.Client
makeClient = do
  opts <- jo [("base", VStr "https://api.example.com")]
  Sdk.newSdk opts
\`\`\`

\`newSdk :: Value -> IO Client\` constructs a client from an options map;
\`newSdk0 :: IO Client\` is the no-argument convenience form.

| Option (map key) | Type | Description |
| --- | --- | --- |
${hsOptionRows(model, (name: string) => '`' + name + '`')}
### Test client

\`\`\`haskell
client <- Sdk.testSdk testopts sdkopts
\`\`\`

\`testSdk :: Value -> Value -> IO Client\` constructs a test-mode client with
mock transport (\`testSdk0 :: IO Client\` for the no-argument form). Pass
\`VNoval\` for defaults.

### Client functions

| Function | Signature | Description |
| --- | --- | --- |
| \`newSdk\` | \`Value -> IO Client\` | Construct a live client from options. |
| \`newSdk0\` | \`IO Client\` | Construct a live client with defaults. |
| \`testSdk\` | \`Value -> Value -> IO Client\` | Construct a test-mode client. |
| \`prepare\` | \`Client -> Value -> IO Value\` | Build an HTTP request definition without sending. Raises on error. |
| \`direct\` | \`Client -> Value -> IO Value\` | Build and send an HTTP request. Returns a result \`Value\` (branch on \`ok\`). |
`)

  each(entityList, (ent: any) => {
    const eFn = hsVarName(ent.name)
    const article = /^[aeiou]/i.test(ent.Name) ? 'an' : 'a'
    Content(`| \`${eFn}\` | \`Client -> Value -> IO Entity\` | Create ${article} ${ent.Name} entity instance. |
`)
  })

  Content(`
### Entity interface

${0 === entityList.length ? '' : (sameOps ? 'All entities share the same record interface (fields of the `Entity` type).' :
  'Each entity has only the operations its model declares; see its section below.') + '\n\n'}| Field | Signature | Description |
| --- | --- | --- |
${opRows}| \`eDataGet\` | \`IO Value\` | Get entity data. |
| \`eDataSet\` | \`Value -> IO ()\` | Set entity data. |
| \`eStream\` | \`String -> Value -> Value -> IO [Value]\` | Run an op as a lazy stream of items. |
| \`eMake\` | \`IO Entity\` | Create a new instance with the same options. |
| \`eName\` | \`String\` | The entity name. |

### Result shape

Entity operations resolve to the ENTITY, not the raw record${opUnion.has('list') ?
  ` \u2014 \`eList\` to
one entity per record \u2014` : ''} and raise on error. The record is reached through
\`eDataGet\`, which returns the entity's data container.${opUnion.has('remove') ? ` \`eRemove\` resolves to
the entity marked as deleted (\`eDeleted\`); it keeps the data it held.` : ''} Wrap calls
in \`Control.Exception.try\` to handle failures.

The \`direct\` escape hatch never raises — it returns a result \`Value\`
you branch on via its \`ok\` field (read with \`getp result "ok"\`):

| Key | Type | Description |
| --- | --- | --- |
| \`ok\` | \`Bool\` | \`True\` if the HTTP status is 2xx. |
| \`status\` | \`Int\` | HTTP status code. |
| \`headers\` | \`Value\` | Response headers. |
| \`data\` | \`Value\` | Parsed JSON response body. |

On error, \`ok\` is \`False\` and \`err\` carries the error value.

`)

  // Entities summary
  if (0 < entityList.length) {
    Content(`### Entities

`)
  }
  each(entityList, (ent: any) => {
    const fields = Object.values(ent.fields || {})
    const opnames = entityOps(ent)
    const path = entityPath(ent)

    Content(`#### ${ent.Name}

${0 === fields.length ? '' : `| Field | Description |
| --- | --- |
`}`)
    each(fields, (field: any) => {
      Content(`| \`${field.n}\` | ${fact(model.main[KIT], 'field')[ent.name]?.[field.n]?.desc.cell ?? ''} |
`)
    })

    // haskell's entity record holds each operation as an `e<Op>` field.
    Content(`
${0 === opnames.length ? '' : `Operations: ${opnames.map((n: string) => 'e' + n.charAt(0).toUpperCase() + n.slice(1)).join(', ')}.

`}${'' === path ? '' : `API path: \`${path}\`

`}`)
  })

})


export {
  ReadmeModel
}
