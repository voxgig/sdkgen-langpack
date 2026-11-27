
import { cmp, Content, introOps } from '@voxgig/sdkgen'

import {
  KIT,
  getModelPath,
  nom,
} from '@voxgig/apidef'


const ReadmeIntroBody = cmp(function ReadmeIntroBody(props: any) {
  const { target, ctx$: { model } } = props

  Content(`The ${target.title} SDK for the ${model.Name} API — an entity-oriented client following idiomatic Dart conventions.

`)

  const entity = getModelPath(model, `main.${KIT}.entity`)
  const exampleEntity = Object.values(entity || {})
    .find((e: any) => e.active !== false) as any
  if (null == exampleEntity) {
    return
  }

  const opList = introOps(model)
    .map((o) => '`' + o + '`').join(', ')
  const carrying = '' === opList ? '' : ` each
carrying a small, uniform set of operations (${opList})`

  Content(`The SDK exposes the API as capitalised, semantic **Entities** — for example \`client.${nom(exampleEntity, 'Name')}()\` —${carrying} instead of raw URL
paths and query strings. You work with named resources and verbs, which
keeps the cognitive load low.

`)
})


export {
  ReadmeIntroBody
}
