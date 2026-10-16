
import { cmp, Content, pickExampleEntity } from '@voxgig/sdkgen'

import {
  KIT,
  getModelPath,
} from '@voxgig/apidef'

import { hsTestCall, hsVarName } from './utility_haskell'


const ReadmeTopTest = cmp(function ReadmeTopTest(props: any) {
  const { target, ctx$: { model } } = props

  const entity = getModelPath(model, `main.${KIT}.entity`)

  const { entity: exampleEntity, primaryOp } = pickExampleEntity(entity)

  Content(`\`\`\`haskell
import qualified SdkClient as Sdk
import VoxgigStruct (Value (..), emptyMap, stringify)
import SdkHelpers (jo)

main :: IO ()
main = do
`)

  if (exampleEntity && primaryOp) {
    const eFn = hsVarName(exampleEntity.name)
    const { argExpr, seedLines } = hsTestCall(exampleEntity, primaryOp, '  ')
    const opCap = 'e' + primaryOp.charAt(0).toUpperCase() + primaryOp.slice(1)
    const resVar = hsVarName(exampleEntity.name) + ('list' === primaryOp ? 's' : '')
    Content(`  -- The offline mock starts empty: seed the record the call reads.
${seedLines}
  sdk <- Sdk.testSdk seed VNoval
  ent <- Sdk.${eFn} sdk VNoval
  arg <- ${argExpr}
  ctrl <- emptyMap
  ${resVar} <- Sdk.${opCap} ent arg ctrl
  ${'list' === primaryOp
    ? `mapM_ (\\en -> putStrLn =<< stringify =<< Sdk.eDataGet en) ${resVar}`
    : `putStrLn =<< stringify =<< Sdk.eDataGet ${resVar}`}
`)
  }
  else {
    Content(`  sdk <- Sdk.testSdk0
`)
  }

  Content(`\`\`\`
`)

})


export {
  ReadmeTopTest
}
