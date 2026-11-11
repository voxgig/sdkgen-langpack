
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

  // Emphasise the entity-oriented design: the SDK surfaces the API as
  // capitalised, semantic Entities with a small, uniform verb set rather
  // than raw URL paths and query strings. The example entity name is
  // derived from the model, never hardcoded.
  const entity = getModelPath(model, `main.${KIT}.entity`)
  const exampleEntity = Object.values(entity || {})
    .find((e: any) => e.active !== false) as any
  const example = exampleEntity
    ? `for example \`client.${nom(exampleEntity, 'Name')}()\` — each`
    : 'each'

  const opList = introOps(model)
    .map((o) => '`' + o + '`').join(', ')

  Content(`The SDK exposes the API as capitalised, semantic **Entities** — ${example}
carrying a small, uniform set of operations (${opList}) instead of raw URL
paths and query strings. You work with named resources and verbs, which
keeps the cognitive load low.

`)
})


export {
  ReadmeIntroBody
}
