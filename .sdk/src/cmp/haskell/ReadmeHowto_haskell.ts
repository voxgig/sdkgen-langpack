
import { cmp, Content, pickExampleEntity, directRoute, cdTarget } from '@voxgig/sdkgen'

import {
  KIT,
  getModelPath,
} from '@voxgig/apidef'

import { hsClient, hsString, hsTestCall, hsVarName } from './utility_haskell'


const ReadmeHowto = cmp(function ReadmeHowto(props: any) {
  const { target, ctx$: { model } } = props
  const dx = directRoute(model)
  const client = hsClient(model)
  const route = (method: string) => `  params <- jo [(${hsString(dx.param)}, VStr "example")]
  args <- jo [("path", VStr ${hsString(dx.path)}), ("method", VStr ${hsString(method)}), ("params", params)]`

  const entity = getModelPath(model, `main.${KIT}.entity`)
  // Pick an entity with a real op (prefer a read op). primaryOp is null only
  // when NO entity exposes any op (a direct()-only SDK).
  const { entity: exampleEntity, primaryOp } = pickExampleEntity(entity)
  const eFn = exampleEntity ? hsVarName(exampleEntity.name) : 'entity'
  const testCall = exampleEntity && primaryOp ? hsTestCall(exampleEntity, primaryOp, '  ') : null
  const testArgExpr = testCall ? testCall.argExpr : 'emptyMap'

  // The op-driven test-mode line, shown only when the SDK has an entity op.
  const testModeExample = 'list' === primaryOp
    ? `  ent <- Sdk.${eFn} sdk VNoval
  arg <- ${testArgExpr}
  ctrl <- emptyMap
  -- eList returns one entity per record and raises on error;
  -- eDataGet reads each mock record.
  ${eFn}s <- Sdk.eList ent arg ctrl
  mapM_ (\\en -> putStrLn =<< stringify =<< Sdk.eDataGet en) ${eFn}s`
    : primaryOp
    ? `  ent <- Sdk.${eFn} sdk VNoval
  arg <- ${testArgExpr}
  ctrl <- emptyMap
  -- Entity ops return the entity and raise on error;
  -- eDataGet reads its mock record.
  ${eFn} <- Sdk.e${primaryOp.charAt(0).toUpperCase() + primaryOp.slice(1)} ent arg ctrl
  putStrLn =<< stringify =<< Sdk.eDataGet ${eFn}`
    : `  args <- jo [("path", VStr ${hsString(dx.path)}), ("method", VStr ${hsString(dx.method)})]
  result <- F.direct sdk args
  putStrLn =<< stringify result`

  Content(`### Make a direct HTTP request

For endpoints not covered by entity accessors, use \`direct\` — it never
raises and returns a result \`Value\` you branch on via its \`ok\` field:

\`\`\`haskell
${client.imports}import qualified SdkClient as Sdk
import qualified SdkFeatures as F
import VoxgigStruct (Value (..), stringify)
import SdkHelpers (jo, getp)

main :: IO ()
main = do
${client.lines}${route(dx.method)}
  result <- F.direct sdk args
  ok <- getp result "ok"
  case ok of
    VBool True -> do
      status <- getp result "status"   -- e.g. VNum 200
      body <- getp result "data"       -- the response body
      putStrLn =<< stringify status
      putStrLn =<< stringify body
    _ -> do
      -- A non-2xx response carries status + data (the error body); a
      -- transport-level failure carries err instead.
      status <- getp result "status"
      err <- getp result "err"
      putStrLn =<< stringify status
      putStrLn =<< stringify err
\`\`\`

### Prepare a request without sending it

\`\`\`haskell
${client.imports}import qualified SdkClient as Sdk
import qualified SdkFeatures as F
import VoxgigStruct (Value (..), stringify)
import SdkHelpers (jo, getp)

main :: IO ()
main = do
${client.lines}${route(dx.method)}
  -- prepare returns the fetch definition and raises on error.
  fetchdef <- F.prepare sdk args
  url <- getp fetchdef "url"
  method <- getp fetchdef "method"
  putStrLn =<< stringify url
  putStrLn =<< stringify method
\`\`\`

### Use test mode

Create a mock client for unit testing — no server required:

\`\`\`haskell
import qualified SdkClient as Sdk
import qualified SdkFeatures as F
import VoxgigStruct (Value (..), emptyMap, stringify)
import SdkHelpers (jo)

main :: IO ()
main = do
${testCall
    ? `  -- The offline mock starts empty: seed the record the call reads.
${testCall.seedLines}
  sdk <- Sdk.testSdk seed VNoval`
    : '  sdk <- Sdk.testSdk0'}
${testModeExample}
\`\`\`

### Use a custom fetch function

Replace the HTTP transport with your own \`VFunc\` under \`system.fetch\`:

\`\`\`haskell
import qualified SdkClient as Sdk
import VoxgigStruct (Value (..))
import SdkHelpers (jo, jsonThunk)

customClient :: IO Sdk.Client
customClient = do
  let mockFetch = VFunc (\\_ _ _ _ -> do
        body <- jo [("id", VStr "mock01")]
        jo [("status", VNum 200), ("statusText", VStr "OK"), ("json", jsonThunk body)])
  sys <- jo [("fetch", mockFetch)]
  opts <- jo [("base", VStr "http://localhost:8080"), ("system", sys)]
  Sdk.newSdk opts
\`\`\`

### Run the test suite

The generated suite runs offline, against the mock transport. This SDK
has no live tests.

\`\`\`bash
${cdTarget(target)}make test
\`\`\`

`)

})


export {
  ReadmeHowto
}
