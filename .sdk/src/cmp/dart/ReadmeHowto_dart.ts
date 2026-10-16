import { cmp, Content, isAuthActive, envName, pickExampleEntity, exampleVarName } from '@voxgig/sdkgen'

import {
  KIT,
  getModelPath,
  nom,
} from '@voxgig/apidef'

import { dartTestCall } from './utility_dart'


const ReadmeHowto = cmp(function ReadmeHowto(props: any) {
  const { target, ctx$: { model } } = props

  const entity = getModelPath(model, `main.${KIT}.entity`)
  // Pick an entity with a real op (prefer a read op) — never fabricate a
  // `load` on an op-less entity. primaryOp is null only when NO entity
  // exposes any op (a direct()-only SDK).
  const { entity: exampleEntity, primaryOp } = pickExampleEntity(entity)
  const eName = exampleEntity ? nom(exampleEntity, 'Name') : 'Entity'
  const eVar = exampleVarName(eName.toLowerCase(), 'dart')
  const testCall = exampleEntity && primaryOp ? dartTestCall(exampleEntity, primaryOp, '') : null
  const testArg = testCall ? testCall.arg : ''

  // The op-driven test-mode line, shown only when the SDK has an entity op.
  // A direct()-only SDK (no ops anywhere) shows a direct() call instead.
  const testModeExample = 'list' === primaryOp
    ? `// list returns one entity per record and throws on error;
// data() reads each mock record.
final ${eVar}s = await client.${eName}().list(${testArg});
for (final item in ${eVar}s) {
  print(item.data());
}`
    : primaryOp
    ? `// Entity ops return the entity and throw on error;
// data() reads its mock record.
final ${eVar} = await client.${eName}().${primaryOp}(${testArg});
print(${eVar}.data());`
    : `final result = await client.direct({'path': '/api/resource', 'method': 'GET'});
print(result);`

  const apikeyEnvLine = isAuthActive(model)
    ? `\nexport ${envName(model)}_APIKEY=<your-key>`
    : ''

  Content(`### Make a direct HTTP request

For endpoints not covered by entity methods:

\`\`\`dart
final result = await client.direct({
  'path': '/api/resource/{id}',
  'method': 'GET',
  'params': {'id': 'example'},
});

if (true == result['ok']) {
  print(result['status']);  // 200
  print(result['data']);    // response body
} else {
  // A non-2xx response carries status + data (the error body); a
  // transport-level failure carries err instead. direct() never throws —
  // branch on result['ok'].
  print(result['status']);
  print(result['err']);
}
\`\`\`

### Prepare a request without sending it

\`\`\`dart
// prepare() returns the fetch definition (or an error value on failure).
final fetchdef = await client.prepare({
  'path': '/api/resource/{id}',
  'method': 'DELETE',
  'params': {'id': 'example'},
});

print(fetchdef['url']);
print(fetchdef['method']);
print(fetchdef['headers']);
\`\`\`

### Use test mode

Create a mock client for unit testing — no server required:

\`\`\`dart
${testCall
    ? `// The offline mock starts empty: seed the record the call reads.
final client = ${model.const.Name}SDK.test(${testCall.seed});`
    : `final client = ${model.const.Name}SDK.test();`}

${testModeExample}
\`\`\`

### Use a custom fetch function

Replace the HTTP transport with your own function:

\`\`\`dart
Future<dynamic> mockFetch(dynamic url, dynamic init) async {
  return {
    'status': 200,
    'statusText': 'OK',
    'headers': <String, dynamic>{},
    'json': () => {'id': 'mock01'},
  };
}

final client = ${model.const.Name}SDK({
  'base': 'http://localhost:8080',
  'system': {
    'fetch': mockFetch,
  },
});
\`\`\`

### Run live tests

Set the live-mode environment variables:

\`\`\`bash
export ${envName(model)}_TEST_LIVE=TRUE${apikeyEnvLine}
\`\`\`

Then run:

\`\`\`bash
cd ${target.name} && dart run test/main.dart
\`\`\`

`)

})


export {
  ReadmeHowto
}
