import { cmp, Content, pickExampleEntity, exampleVarName, directRoute, cdTarget, fact } from '@voxgig/sdkgen'

import {
  KIT,
  getModelPath,
  nom,
} from '@voxgig/apidef'

import { dartTestCall } from './utility_dart'


const ReadmeHowto = cmp(function ReadmeHowto(props: any) {
  const { target, ctx$: { model } } = props
  const dx = directRoute(model)
  const kit = model.main[KIT]
  const ENV = fact(kit, 'env')

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
    : `final result = await client.direct({'path': '${dx.path}', 'method': '${dx.method}'});
print(result);`

  // What the live tests read: the key, the Basic secret, the server variables.
  const apikeyEnvLine = fact(kit, 'auth').apikey
    ? `\nexport ${ENV.apikey}=<your-key>${fact(kit, 'auth').secret ? `\nexport ${ENV.secret}=<your-secret>` : ''}`
    : ''
  const serverEnvLine = fact(kit, 'server').filter((v: any) => v.required)
    .map((v: any) => `\nexport ${ENV.server[v.name]}=<${v.name}>`).join('')
  const defaulted = fact(kit, 'server').filter((v: any) => !v.required)
  const liveEnvNote = (0 === defaulted.length ? '' :
    defaulted.map((v: any) => '`' + ENV.server[v.name] + '`').join(', ') +
    (1 === defaulted.length ? ', when set, replaces its server variable\'s default.\n'
      : ', when set, replace their server variables\' defaults.\n')) +
    'Each entity\'s tests also read `' + ENV.prefix + '_TEST_<ENTITY>_ENTID`, with the\n' +
    'entity\'s name in capitals: a JSON object of the ids of existing records, for\n' +
    'the tests that do not create their own.\n\n'

  Content(`### Make a direct HTTP request

For endpoints not covered by entity methods:

\`\`\`dart
final result = await client.direct({
  'path': '${dx.path}',
  'method': '${dx.method}',
  'params': {'${dx.param}': 'example'},
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
  'path': '${dx.path}',
  'method': '${dx.method}',
  'params': {'${dx.param}': 'example'},
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
export ${ENV.live}=TRUE${apikeyEnvLine}${serverEnvLine}
\`\`\`

${liveEnvNote}Then run:

\`\`\`bash
${cdTarget(target)}dart run test/main.dart
\`\`\`

`)

})


export {
  ReadmeHowto
}
