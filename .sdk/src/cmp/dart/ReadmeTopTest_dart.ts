
import { cmp, Content, pickExampleEntity, exampleVarName } from '@voxgig/sdkgen'

import {
  KIT,
  getModelPath,
  nom,
} from '@voxgig/apidef'

import { dartPackageName } from './Package_dart'
import { dartTestCall } from './utility_dart'


const ReadmeTopTest = cmp(function ReadmeTopTest(props: any) {
  const { target, ctx$: { model } } = props

  const entity = getModelPath(model, `main.${KIT}.entity`)
  const pkg = dartPackageName(model)

  // Pick an entity with a real op (prefer a read op) — never fabricate a
  // `load` on an op-less entity.
  const { entity: exampleEntity, primaryOp } = pickExampleEntity(entity)

  Content(`\`\`\`dart
import 'package:${pkg}/${model.const.Name}SDK.dart';

Future<void> main() async {
`)

  if (exampleEntity && primaryOp) {
    const eName = nom(exampleEntity, 'Name')
    const { arg, seed } = dartTestCall(exampleEntity, primaryOp, '  ')
    const eVar = exampleVarName(eName.toLowerCase(), 'dart') + ('list' === primaryOp ? 's' : '')
    Content(`  // The offline mock starts empty: seed the record the call reads.
  final client = ${model.const.Name}SDK.test(${seed});
  final ${eVar} = await client.${eName}().${primaryOp}(${arg});
${'list' === primaryOp
    ? `  for (final item in ${eVar}) {
    print(item.data());
  }`
    : `  print(${eVar}.data());`}
`)
  }
  else {
    Content(`  final client = ${model.const.Name}SDK.test();
`)
  }

  Content(`}
\`\`\`
`)

})


export {
  ReadmeTopTest
}
