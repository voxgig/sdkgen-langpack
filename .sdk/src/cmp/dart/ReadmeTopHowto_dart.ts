
import { cmp, Content, directRoute } from '@voxgig/sdkgen'


const ReadmeTopHowto = cmp(function ReadmeTopHowto(props: any) {
  const dx = directRoute(props.ctx$.model)

  Content(`**Dart:**
\`\`\`dart
final result = await client.direct({
  'path': '${dx.path}',
  'method': '${dx.method}',
  'params': {'${dx.param}': 'example'},
});
\`\`\`

`)

})


export {
  ReadmeTopHowto
}
