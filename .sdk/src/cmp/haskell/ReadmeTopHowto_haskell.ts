
import { cmp, Content, directRoute } from '@voxgig/sdkgen'

import { hsClient, hsString } from './utility_haskell'


const ReadmeTopHowto = cmp(function ReadmeTopHowto(props: any) {
  const { ctx$: { model } } = props
  const dx = directRoute(model)
  const client = hsClient(model)

  Content(`**Haskell:**
\`\`\`haskell
${client.imports}import qualified SdkClient as Sdk
import qualified SdkFeatures as F
import VoxgigStruct (Value (..), stringify)
import SdkHelpers (jo)

main :: IO ()
main = do
${client.lines}  params <- jo [(${hsString(dx.param)}, VStr "example")]
  args <- jo [("path", VStr ${hsString(dx.path)}), ("method", VStr ${hsString(dx.method)}), ("params", params)]
  result <- F.direct sdk args
  putStrLn =<< stringify result
\`\`\`

`)

})


export {
  ReadmeTopHowto
}
