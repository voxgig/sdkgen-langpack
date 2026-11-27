
import { cmp, Content, pickExampleEntity, exampleVarName } from '@voxgig/sdkgen'

import { KIT, getModelPath, nom } from '@voxgig/apidef'

import { dartPackageName } from './Package_dart'
import { dartTestCall } from './utility_dart'


const ReadmeExplanation = cmp(function ReadmeExplanation(props: any) {
  const { target, ctx$: { model } } = props

  const Name = model.const.Name
  const pkg = dartPackageName(model, target.name)

  Content(`### Maps in, typed models alongside

The Dart SDK passes plain \`Map<String, dynamic>\` values through the
operation pipeline rather than requiring typed objects at every call. This
mirrors the dynamic nature of the API and keeps calls terse — a create is
just \`create({'name': 'example'})\`.

For a typed, documented view of each entity and operation, the generated
\`${Name}Types.dart\` provides a class per entity plus per-op request/match
classes (e.g. \`${Name}.fromMap(entity.data())\` and \`model.toMap()\`), so you
can convert to and from those maps wherever you want compile-time structure.
The typed models follow the schema only when the SDK is regenerated.

### Package structure

\`\`\`
${target.name}/
├── lib/
│   ├── ${Name}SDK.dart          -- Main SDK library (exported entry point)
│   ├── ${Name}Types.dart        -- Typed entity + request/match models
│   ├── ${Name}EntityBase.dart   -- Base class for entities
│   ├── ${Name}Error.dart        -- SDK error type
│   ├── Config.dart              -- Configuration
│   ├── entity/                  -- Entity implementations
│   ├── feature/                 -- Feature implementations
│   └── utility/                 -- Utility functions and vendored struct library
└── test/                        -- Test suites (dart run test/main.dart)
\`\`\`

The main library (\`${Name}SDK.dart\`) re-exports the SDK class, the typed
models, and every entity class, so a single
\`import 'package:${pkg}/${Name}SDK.dart';\`
brings in everything you need.

`)

  // sdkgen's explanation writes this section only for its bundled languages.
  const { entity: ex, primaryOp } =
    pickExampleEntity(getModelPath(model, `main.${KIT}.entity`) || {})
  if (null != ex && null != primaryOp) {
    const eName = nom(ex, 'Name')
    const eVar = exampleVarName(eName.toLowerCase(), 'dart')
    Content(`### Entity state

Entity instances are stateful. After a successful \`${primaryOp}\`, the entity
stores the returned data and match criteria internally.

\`\`\`dart
final ${eVar} = client.${eName}();
await ${eVar}.${primaryOp}(${dartTestCall(ex, primaryOp, '').arg});

// ${eVar}.data() now returns the ${eVar} data from the last ${primaryOp}
// ${eVar}.match() returns the last match criteria
\`\`\`

Call \`make()\` to create a fresh instance with the same configuration
but no stored state.

`)
  }
})


export {
  ReadmeExplanation
}
