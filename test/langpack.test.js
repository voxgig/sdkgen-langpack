// The language pack's suite: dart, haskell and lean.
//
// ONE PACKAGE, THREE TARGETS. `sdkgen-package.json` lists all three in
// `provides.target`, so a single `package add` installs all three and a
// consumer wanting one asks for it by path
// (`target add @voxgig/sdkgen-langpack/dart`). This suite exercises the first
// form, because it is the one that would break silently: a target present in
// the tree but missing from the manifest installs for nobody, and a target in
// the manifest with no tree fails at add time for everybody.
//
// The tests run on `@voxgig/sdkgen/testkit`, so the pipeline under test is the
// real one — `package add` installs this package into a staged consumer, the
// consumer's components are compiled the way its own build compiles them, and
// generation runs from `.sdk`.
//
// Two of these tests came from sdkgen's own suites and moved with their
// targets, which is the point of packaging: a target's coverage travels with
// the target.

const { test, describe, before, after } = require('node:test')
const { ok, strictEqual, deepStrictEqual } = require('node:assert')

const Fs = require('node:fs')
const Path = require('node:path')

const { stageConsumer, generateInto } = require('@voxgig/sdkgen/testkit')
const { cmp, each, names, Project, Folder, ReadmeTop, Entity, Readme } = require('@voxgig/sdkgen')

const { PKG, TARGETS, CHILD, compile, consumerModel } = require('./stage')


const PLANET_REMOVE = `
main: kit: entity: planet: op: remove: {
  name: "remove"
  points: [ {
    g: { params: [
      { k: "param", n: "id", or: "id", r: true, t: "\`$STRING\`", ex: "p01" }
    ] }
    m: "DELETE", o: "/planet/{id}", s: [{ lit: "planet" }, { var: "id" }]
    t: { req: "\`reqdata\`", res: "\`body\`" }
  } ]
}
`


// EVERY ENTITY OPERATION RETURNS THE ENTITY, whose record an accessor reads.
// These are the checks sdkgen's generate.test.ts runs over its bundled targets.
// lean has no entity object, so it returns the record and is not read here.
const ACCESSOR = { dart: 'data()', haskell: 'eDataGet' }

const RETURNS = (target) => ({
  load: new RegExp('\\bthe entity, whose record `' +
    ACCESSOR[target].replace(/[()]/g, '\\$&') + '` reads\\b'),
  list: /\bentities, one per record\b|\bone entity per record\b/,
  create: /\bthe created entity\b(?! data)/,
  update: /\bthe updated entity\b(?! data)/,
  patch: /\bthe patched entity\b(?! data)/,
  remove: /\bthe entity, marked as deleted\b/,
})

// A page leads with the first active entity, and a test-mode example with the
// first operation of the entity it picks, so each model shows other branches:
// every operation, a load-only singleton, and a load nested under a parent.
const DOC_MODELS = {
  crud: PLANET_REMOVE,
  singleton: `
main: kit: entity: planet: active: false
main: kit: entity: ambient: {
  alias: field: {}
  name: "ambient"
  fields: { "level": { h: 'Level', n: "level", r: false, t: "\`$NUMBER\`" } }
  op: load: { name: "load", points: [ {
    g: {}, m: "GET", o: "/ambient", s: [{ lit: "ambient" }]
    t: { req: "\`reqdata\`", res: "\`body\`" }
  } ] }
}
main: kit: flow: BasicAmbientFlow: {
  entity: "ambient", kind: "basic", name: "BasicAmbientFlow"
  step: [ { o: "load", i: {
    ref: "ambient_ref01", srcdatavar: "ambient_ref01_data", suffix: "_dt0" } } ]
}
`,
  nested: PLANET_REMOVE + `
main: kit: entity: satellite: {
  alias: field: {}
  name: "satellite"
  id: { field: "id", name: "id" }
  relations: ancestors: [[path($.main.kit.entity.planet)]]
  fields: {
    "id": { h: 'Id', n: "id", r: true, t: "\`$STRING\`" }
    "planet_id": { h: 'PlanetId', n: "planet_id", r: false, t: "\`$STRING\`" }
  }
  op: load: { name: "load", points: [ {
    g: { params: [
      { k: "param", n: "planet_id", or: "planet_id", r: true, t: "\`$STRING\`", ex: "p01" }
      { k: "param", n: "id", or: "id", r: true, t: "\`$STRING\`", ex: "s01" }
    ] }
    m: "GET", o: "/planet/{planet_id}/satellite/{id}"
    s: [{ lit: "planet" }, { var: "planet_id" }, { lit: "satellite" }, { var: "id" }]
    t: { req: "\`reqdata\`", res: "\`body\`" }
  } ] }
}
main: kit: flow: BasicSatelliteFlow: {
  entity: "satellite", kind: "basic", name: "BasicSatelliteFlow"
  step: [ { o: "load", m: { planet_id: "planet01" }, i: {
    ref: "satellite_ref01", srcdatavar: "satellite_ref01_data", suffix: "_dt0" } } ]
}
`,
}

// The branch each model is there to show.
const DOC_MODEL_SHOWS = {
  crud: [['dart/README.md', 'client.Planet().remove('], ['haskell/README.md', 'Sdk.eRemove ']],
  singleton: [['dart/README.md', 'client.Ambient().load()'],
    ['haskell/README.md', 'Sdk.eLoad ent arg ctrl']],
  nested: [['dart/README.md', '### 3. Load a satellite'],
    ['haskell/README.md', '### 3. Load a satellite']],
}

// The pages a reader sees. ReadmeTop is the only route to each target's
// ReadmeTopQuick and ReadmeTopTest.
function docsRoot() {
  return cmp(function Root(props) {
    const { model, ctx$ } = props
    model.const = model.const || { name: model.name }
    names(model.const, model.name)
    names(model, model.name)
    ctx$.model = model
    ctx$.stdrep = ctx$.stdrep || {}
    names(ctx$.stdrep, model.Name, 'ProjectName')

    const { target, entity } = model.main.kit
    Project({}, () => {
      ReadmeTop({})
      each(target).filter((t) => false !== t.active).map((t) => {
        names(t, t.name)
        Folder({ name: t.name }, () => {
          each(entity).filter((e) => false !== e.active).map((e) => {
            names(e, e.name)
            Entity({ target: t, entity: e })
          })
          Readme({ target: t })
        })
      })
    })
  })
}

// Each heading under a reference's `### Operations`, with the paragraph below it.
function operationDocs(ref) {
  const docs = []
  const lines = ref.split('\n')
  let inOps = false
  lines.forEach((line, i) => {
    if (/^#{2,3} /.test(line)) {
      inOps = /^### Operations\s*$/.test(line)
    }
    else if (inOps && line.startsWith('#### ')) {
      const rest = lines.slice(i + 1)
      const start = rest.findIndex((l) => '' !== l.trim())
      const end = rest.findIndex((l, j) => start < j && '' === l.trim())
      docs.push({ heading: line, desc: rest.slice(start, end < 0 ? undefined : end).join(' ') })
    }
  })
  return docs
}

function codeBlocks(text, fence) {
  return [...text.matchAll(/^```(\w+)\n([\s\S]*?)^```$/gm)]
    .filter((m) => fence === m[1]).map((m) => m[2])
}

// How each target's examples call an operation, read a record, print, and bind
// a name.
const EXAMPLE = {
  dart: {
    call: /\.(load|list|create|update|patch|remove)(?=\()/,
    reads: /\.data\(\)/,
    print: /\bprint\(/,
    bound: /^\s*(?:final|var)\s+(\w+)\s*=/,
  },
  haskell: {
    call: /\bSdk\.e(Load|List|Create|Update|Patch|Remove)\b/,
    reads: /\beDataGet\b/,
    print: /\b(?:print|putStrLn)\b/,
    bound: /^\s*(\w+)\s*<-/,
  },
}

// A line without the arguments of the operation it calls, which begin at `at`.
// A record read there is an argument, not what the operation returns.
function withoutArgs(line, at) {
  const own = '(' === line.slice(at).trimStart()[0]
  let depth = 0
  let end = at
  for (; end < line.length; end++) {
    if ('(' === line[end]) depth++
    else if (')' === line[end]) {
      if (0 === depth) break
      if (0 === --depth && own) { end++; break }
    }
  }
  return line.slice(0, at) + line.slice(end)
}

// Each print after an operation other than remove, up to the next one, that
// shows neither the record nor a name bound to it.
function entityPrints(target, code) {
  const { call, reads, print, bound } = EXAMPLE[target]
  const found = []
  let op = ''
  let recs = []
  for (const line of code.split('\n')) {
    if (/^\s*(?:\/\/|--)/.test(line)) continue
    const m = call.exec(line)
    if (null != m) {
      op = m[1].toLowerCase()
      recs = []
    }
    if ('' === op || 'remove' === op) continue
    if (reads.test(null == m ? line : withoutArgs(line, m.index + m[0].length))) {
      const name = bound.exec(line)
      if (null != name) recs.push(name[1])
    }
    else if (print.test(line) && !/fail|\berr\b|\berror\b/i.test(line) &&
      !recs.some((name) => new RegExp('\\b' + name + '\\b').test(line))) {
      found.push(op + ': ' + line.trim())
    }
  }
  return found
}

// Neither haskell's Value nor its Entity has a Show instance, so `print` takes
// only the flag remove sets; anything else is shown through stringify.
const HS_UNSHOWABLE = /^(?!\s*--).*\bprint\b(?! =<< readIORef\b).*$/gm

const RECORD_PHRASES = [
  /\(returns the record\b/i,
  /\bthe value is the loaded record\b/i,
  /\bbare (?:created )?record\b/i,
  /\bbare result\b/i,
  /\baggregate list\b/i,
  /\bValue list\b(?! of entities)/,
  /\bfor single-entity ops\b/i,
  /\bresult data directly\b/i,
  /\boperation's data\b/i,
  /\bentity records?\b/i,
  /\b(?:holds|contains) the mock response record\b/i,
  /\breturns the (?:created |updated |patched |removed )?entity data\b/i,
  /\bentity data (?:directly|map)\b/i,
  /\bresolves to (?:void|undefined|nil|None|null)\b/i,
  /\blist of records\b/i,
  /\breturned mock data\b/i,
  /\bis the returned data\b/i,
  /\bcast results\b/i,
  /\bread fields off results\b/i,
]


describe('sdkgen-langpack', () => {

  let consumer
  let generated

  before(async () => {
    consumer = stageConsumer({ recordLog: true })
    await consumer.addPackage(PKG)
    compile(consumer)

    // Generated ONCE and shared: generation is the slow part, and every test
    // below asks a different question of the same output.
    generated = await generateInto(consumer, { model: consumerModel(consumer.sdk) })
  })

  after(() => {
    if (null != consumer) consumer.cleanup()
  })


  test('one package add installs every target it provides', () => {
    const files = consumer.files()

    for (const t of TARGETS) {
      ok(files.includes('model/target/' + t + '.aontu'), t + ': no target model')
      ok(files.some((f) => f.startsWith('src/cmp/' + t + '/')), t + ': no components')
      ok(files.some((f) => f.startsWith('tm/' + t + '/')), t + ': no templates')
    }
  })


  // Every target generates, and nothing leaks. This is the placeholder scan
  // sdkgen's `generate.test.ts` runs over the bundled targets — the only
  // content guard either suite has — and it has to run here now, or a Copy or
  // Fragment added without `...ctx$.stdrep` would ship an SDK naming itself
  // "ProjectName" at runtime with every suite green.
  for (const target of TARGETS) {
    test(target + ' generates, with no placeholder left in it', () => {
      const mine = Object.keys(generated.files).filter((p) => p.startsWith(target + '/'))

      ok(0 < mine.length,
        target + ': nothing generated:\n  ' +
        Object.keys(generated.files).join('\n  '))

      deepStrictEqual(generated.leaks.filter((l) => l.startsWith(target + '/')), [],
        target + ': a placeholder survived into generated output')
    })
  }


  // No target may generate into another's folder. With one package shipping
  // three targets, a component that hardcoded a sibling's directory name —
  // or a Copy pointed at the wrong `tm/` tree — would produce exactly this,
  // and every per-target assertion above would still pass.
  test('targets do not generate into each other', () => {
    const dirs = new Set(Object.keys(generated.files).map((p) => p.split('/')[0]))

    for (const t of TARGETS) {
      ok(dirs.has(t), t + ': generated nothing')
    }
  })


  // THE .cabal MUST DECLARE EVERY MODULE IT SHIPS.
  //
  // `make test` drives ghc directly with `-isrc`, so it compiles whatever is
  // on disk and never notices an undeclared module — but `cabal build` needs
  // the declaration and `cabal sdist` does not reliably package a module the
  // library does not list. Promoting the JSON reader to `src/SdkJson.hs` for
  // the data path added a module and left it undeclared: `make test` stayed
  // green while a published data-path SDK could not compile its own
  // `SdkConfig` import.
  //
  // Checked on BOTH representations, because the data branch is what pulls
  // SdkJson in, and generically rather than by name, so the next promoted
  // module cannot repeat this.
  for (const repr of ['literal', 'data']) {
    test('the cabal library declares every src module (' + repr + ')',
      async () => {
        const { files } = await generateInto(consumer, {
          model: consumerModel(consumer.sdk,
            "main: kit: config: repr: '" + repr + "'"),
        })

        const entries = Object.entries(files)
          .filter(([p]) => p.startsWith('haskell/'))

        const cabal = entries.find(([n]) => /\.cabal$/.test(n))
        ok(cabal, 'no .cabal generated')
        const declared = String(cabal[1])

        const mods = entries
          .map(([n]) => n.match(/\/src\/([^/]+)\.hs$/))
          .filter(Boolean)
          .map((m) => m[1])
        ok(0 < mods.length, 'no src modules in the generated output')

        for (const mod of mods) {
          ok(new RegExp('\\b' + mod + '\\b').test(declared),
            repr + ': src/' + mod + '.hs is not declared in the .cabal, so ' +
            'cabal build/sdist would not package it')
        }
      })
  }


  // struct's Haskell `Value` holds a map as an ORDERED assoc list, so key
  // order is observable — it survives into keysof, iteration and stringify.
  //
  // formatHsValue used to sort, which was invisible while the literal was the
  // only representation. Above the threshold the same config arrives via
  // jsonRead in the JSON text's order, and the two would have described the
  // same config in a different order. Confirmed by dumping the materialised
  // config from both branches under GHC 9.4.7: with sorting the two disagreed
  // from the very first key, and only match with insertion order preserved.
  test('the haskell config literal preserves key order, and does not sort', () => {
    // From the STAGED consumer's compiled tree, which is where a consumer's
    // own build puts it — the same place `requirePath` reads.
    const { formatHsValue } = require(
      Path.join(consumer.sdk, 'dist', 'cmp', 'haskell', 'utility_haskell.js'))

    // The canonical config's own top-level order: NOT alphabetical.
    const def = { main: {}, feature: {}, options: {}, entity: {} }
    const keys = (formatHsValue(def).match(/"(main|feature|options|entity)"/g) || [])
      .map((s) => s.replace(/"/g, ''))

    strictEqual(keys.join(','), 'main,feature,options,entity',
      'formatHsValue reordered the config keys, so the literal would ' +
      'disagree with jsonRead of the same config')
  })


  // lean HAS NO ENTITY OBJECT, by construction — see sdkgen's AGENTS.md.
  //
  // Its ops are namespaced free functions over the client value
  // (`Planet.load c m co`), dispatched by the config-driven SdkRuntime, so
  // there is no instance to return and no `.data()` hop. That is a boundary
  // rather than a gap, and it is worth pinning: the entity-returning contract
  // every other target honours would look like a missing feature here, and
  // "fixing" it means designing an entity layer for lean, not porting a
  // signature.
  test('lean emits namespaced functions, not an entity class', () => {
    const mine = Object.entries(generated.files)
      .filter(([p]) => p.startsWith('lean/'))

    ok(0 < mine.length, 'lean generated nothing')

    const entityFiles = mine.filter(([p]) => /Entity/i.test(Path.basename(p)))
    deepStrictEqual(entityFiles.map(([p]) => p), [],
      'lean generated an entity source file — if that is deliberate, this ' +
      'target has grown an entity layer and the contract note in sdkgen\'s ' +
      'AGENTS.md needs revisiting')
  })


  // GHC's readFile decodes with the locale's encoding, so under a C or POSIX
  // locale it cannot read the generated docs, and the README gate read them
  // as absent and passed. CI runs with a UTF-8 locale, where nothing else
  // would show a bare readFile coming back.
  test('the haskell tests read files as UTF-8, not through the locale', () => {
    const tests = Object.entries(generated.files)
      .filter(([p]) => /^haskell\/test\/[^/]+\.hs$/.test(p))
    ok(0 < tests.length, 'no haskell test sources generated')

    const code = (src) => String(src).split('\n')
      .filter((line) => !/^\s*--/.test(line)).join('\n')

    deepStrictEqual(
      tests.filter(([, src]) => /\breadFile\b/.test(code(src))).map(([p]) => p), [],
      'a haskell test reads a file with the locale-dependent readFile; use readUtf8')

    const util = tests.find(([p]) => p.endsWith('/Testutil.hs'))
    ok(util && /hSetEncoding h utf8/.test(String(util[1])),
      'Testutil.hs no longer decodes readUtf8 as UTF-8')
  })


  // A PATCH beside a PUT is a sixth operation, `patch`, which every target
  // generates as it does `update`: its own entry, under its own name.
  test('every target generates the patch operation', () => {
    const file = (path) => {
      ok(null != generated.files[path], 'not generated: ' + path)
      return generated.files[path]
    }

    const dart = file('dart/lib/entity/PlanetEntity.dart')
    ok(/Future<dynamic> patch\(\[dynamic reqdata, dynamic ctrl\]\)/.test(dart) &&
      /'opname': 'patch'/.test(dart), 'dart: no patch method')

    // sdkgen's opTypeName names the request type; before the floor's release
    // it fell back to Match for a patch.
    const types = file('dart/lib/DemoTypes.dart')
    ok(/^class PlanetPatchData \{/m.test(types) && !/PlanetPatchMatch/.test(types),
      'dart: the patch request type is not named PlanetPatchData')

    ok(file('lean/src/SdkClient.lean').includes(
      'def patch (c m d co : Value) : SIO Value := SdkRuntime.opPatch c "planet" m d co'),
    'lean: no patch wrapper')

    ok(file('haskell/REFERENCE.md').includes('ePatch ent data ctrl :: IO Entity'),
      'haskell: the reference does not document ePatch')
  })


  // A fixture need not hold a `new` record for every entity: one a project
  // wrote, or an older scaffold's, may not. haskell's newRefData and dart's
  // patch test then create from an empty map, and lean must too, or its
  // offline create and patch checks print nothing and the tally just shrinks.
  test('lean creates from an empty map when the fixture holds no new record', async () => {
    // A remove beside the create, so the create/load/remove check is emitted
    // as well as the patch check.
    const { files } = await generateInto(consumer, {
      model: consumerModel(consumer.sdk, PLANET_REMOVE),
    })
    const runner = files['lean/test/Runner.lean']
    ok(null != runner, 'lean: no test/Runner.lean generated')
    const lines = String(runner).split('\n')

    const creates = lines.filter((l) => /\bPlanet\.create tclient\b/.test(l))
    strictEqual(creates.length, 2,
      'lean: expected the create/load/remove and the patch checks each to create:\n' +
      creates.join('\n'))
    for (const line of creates) {
      ok(line.includes('(← newRefData seed "planet")'),
        'lean: an offline check creates only from a new record the fixture holds: ' +
        line.trim())
    }

    // The seed's new records are read in that one place, which falls back.
    const at = lines.findIndex((l) => l.startsWith('def newRefData '))
    ok(-1 < at, 'lean: test/Runner.lean defines no newRefData')
    const helper = lines.slice(at, lines.indexOf('', at))
    const reads = lines.filter((l) => l.includes('"new"'))
    ok(1 === reads.length && helper.includes(reads[0]),
      'lean: the seed\'s new records are not read once, in newRefData:\n' + reads.join('\n'))
    ok(helper.includes('  | none => emptyMap'),
      'lean: newRefData gives no empty map for a seed without a new record')
  })


  // makeUrl refuses a route with a {placeholder} left in it, so a child's test
  // call gives its parent's id beside its own, read from the record it acts on.
  test('a child entity\'s test calls give its parent\'s id', async () => {
    const { files } = await generateInto(consumer, {
      model: consumerModel(consumer.sdk, CHILD),
    })
    const hs = String(files['haskell/test/SdkGenTests.hs'])
    for (const line of [
      '    em1 <- emptyMap; em2 <- emptyMap\n    entmap <- getp existing "moon"',
      '    setp em1 "planet_id" =<< getp rec0 "planet_id"\n    lst <- eList ent em1 em2',
      '        setp m "planet_id" =<< getp rec0 "planet_id"\n        loaded <- eLoad ent m ctrl',
      '  let parentVals = [("planet_id", VStr "P1")]',
    ]) {
      ok(hs.includes(line), 'haskell: the moon test lacks:\n' + line)
    }

    const lean = String(files['lean/test/Runner.lean'])
    for (const line of [
      '          SdkUtility.sp lm "planet_id" (← SdkUtility.gp rec0 "planet_id")\n        let items ← Moon.list tclient lm',
      '          SdkUtility.sp m "planet_id" (← SdkUtility.gp rec0 "planet_id")\n          let got ← Moon.load tclient m',
    ]) {
      ok(lean.includes(line), 'lean: the moon test lacks:\n' + line)
    }

    // dart's stream test lists with no match, so a child has none.
    ok(!String(files['dart/test/entity/moon/MoonEntity_test.dart']).includes("test('stream'"),
      'dart: the moon test streams its list with no parent id')
    ok(String(files['dart/test/entity/planet/PlanetEntity_test.dart']).includes("test('stream'"),
      'dart: the planet test no longer streams its list')
  })


  const docsOut = new Map()
  const docs = (shape) => {
    if (!docsOut.has(shape)) {
      docsOut.set(shape, generateInto(consumer, {
        model: consumerModel(consumer.sdk, DOC_MODELS[shape]), root: docsRoot(),
      }).then((res) => res.files))
    }
    return docsOut.get(shape)
  }


  test('the reference says each operation returns the entity', async () => {
    const out = await docs('crud')
    const wrong = []
    for (const target of Object.keys(ACCESSOR)) {
      const ref = out[target + '/REFERENCE.md']
      ok(null != ref, target + ': no REFERENCE.md generated')
      const expect = RETURNS(target)
      const documented = []
      for (const { heading, desc } of operationDocs(ref)) {
        const named = /^#### `e?(load|list|create|update|patch|remove)\b/i.exec(heading)
        ok(null != named, target + ': an operation heading names no operation: ' + heading)
        const op = named[1].toLowerCase()
        documented.push(op)
        if (!expect[op].test(desc) || /\bentity data\b/.test(desc)) {
          wrong.push(target + ' ' + op + ': ' + desc)
        }
      }
      deepStrictEqual(documented.sort(), Object.keys(expect).sort(),
        target + ': the operations its reference documents')
    }
    deepStrictEqual(wrong, [], 'operations the reference says return a record')
  })


  // dart declares every operation Future<dynamic>, so its doc comment says what
  // the operation returns; haskell's Entity type declares it.
  test('each operation is declared to return the entity', async () => {
    const out = await docs('crud')
    const expect = RETURNS('dart')
    const wrong = []

    const dart = out['dart/lib/entity/PlanetEntity.dart']
    ok(null != dart, 'dart: no entity source generated')
    const declared = []
    for (const [, comment, type, op] of dart.matchAll(
      /((?:^[ \t]*\/\/\/.*\n)+)[ \t]*(\S+) (load|list|create|update|patch|remove)\(/gm)) {
      declared.push(op)
      const says = comment.replace(/^[ \t]*\/\/\/ ?/gm, '').replace(/\s+/g, ' ').trim()
      if ('Future<dynamic>' !== type || !expect[op].test(says) || /\bentity data\b/.test(says)) {
        wrong.push('dart ' + op + ': ' + type + ' /// ' + says)
      }
    }
    deepStrictEqual(declared.sort(), Object.keys(expect).sort(), 'dart: the operations declared')

    const types = Fs.readFileSync(Path.join(PKG, '.sdk', 'tm', 'haskell', 'src', 'SdkTypes.hs'), 'utf8')
    const fields = []
    for (const [, op, type] of types.matchAll(
      /^\s*, e(Load|List|Create|Update|Patch|Remove)\s+:: (.+)$/gm)) {
      fields.push(op.toLowerCase())
      const want = 'Value -> Value -> IO ' + ('List' === op ? '[Entity]' : 'Entity')
      if (want !== type.trim()) wrong.push('haskell ' + op + ': ' + type.trim())
    }
    deepStrictEqual(fields.sort(), Object.keys(expect).sort(), 'haskell: the operations declared')

    deepStrictEqual(wrong, [], 'operations declared to return a record')
  })


  test('every example prints the record of the entity an operation returns', async () => {
    const wrong = []
    for (const shape of Object.keys(DOC_MODELS)) {
      const out = await docs(shape)
      for (const [path, text] of DOC_MODEL_SHOWS[shape]) {
        ok(String(out[path]).includes(text), shape + ': ' + path + ' no longer shows ' + text)
      }
      for (const target of Object.keys(ACCESSOR)) {
        for (const path of ['README.md', target + '/README.md', target + '/REFERENCE.md']) {
          ok(null != out[path], shape + ' ' + target + ': no ' + path)
          for (const code of codeBlocks(out[path], target)) {
            for (const line of entityPrints(target, code)) {
              wrong.push(shape + ' ' + path + ' ' + target + ': ' + line)
            }
            if ('haskell' === target) {
              for (const [line] of code.matchAll(HS_UNSHOWABLE)) {
                wrong.push(shape + ' ' + path + ' haskell, no Show instance: ' + line.trim())
              }
            }
          }
        }
      }
    }
    deepStrictEqual([...new Set(wrong)], [], 'examples that print the entity, not its record')
  })


  test('no page says an entity operation returns a record', async () => {
    const said = []
    for (const shape of Object.keys(DOC_MODELS)) {
      const out = await docs(shape)
      for (const target of Object.keys(ACCESSOR)) {
        const pages = [
          ['README.md', codeBlocks(out['README.md'], target).join('\n')],
          [target + '/README.md', out[target + '/README.md']],
          [target + '/REFERENCE.md', out[target + '/REFERENCE.md']],
        ]
        for (const [path, text] of pages) {
          const flat = String(text).replace(/`/g, '').replace(/\s+/g, ' ')
          for (const re of RECORD_PHRASES) {
            const m = re.exec(flat)
            if (null != m) {
              said.push(shape + ' ' + path + ' ' + target + ': ' +
                flat.substr(Math.max(0, m.index - 40), 100))
            }
          }
        }
      }
    }
    deepStrictEqual([...new Set(said)], [], 'pages that say an operation returns a record')
  })
})


// THE DART SECRETS SEAM, and the two hazards only dart has.
//
// This test moved here from sdkgen's `generate.test.ts` with the dart target
// — a target's coverage travels with the target. It gets its own staged
// consumer because it is the only test in this file that needs the secrets
// FEATURE installed, and installing it into the shared one would change
// what every other test sees generated.
//
// An ACTIVE secrets model must emit the `show` imports and the
// FEATURE_PLUGINS entries into lib/Config.dart, and the INACTIVE groups'
// vendored files must stay out of the tree (Main_dart's pluginExcludes),
// while the shared httpjson helper (in no group) ships regardless.
//
// FIRST DART HAZARD: the whole sekreto CORE lives at `sekreto/src/*.dart`,
// upstream's layout. Main_dart's Copy excluded `/src\//` unanchored — for the
// `tm/dart/src/feature/<name>/` copy-target dirs — and that pattern matched
// the vendored core too, so the entire secrets library was dropped from the
// package while the plugins beside it survived. `dart analyze` reported it as
// undefined symbols in httpjson.dart, naming nothing that would lead you to
// the Copy.
//
// SECOND DART HAZARD: test/main.dart is a HAND-LISTED suite entry — dart has
// no `go test ./...` or pytest discovery — so the secrets suite must be
// registered there or it ships and never runs, with the lane green.
describe('sdkgen-langpack: dart secrets', () => {

  let consumer
  let active
  let plain

  before(async () => {
    consumer = stageConsumer({ recordLog: false })
    await consumer.addPackage(PKG)
    // The feature model is sdkgen's, not this pack's: `def: dart` lives in
    // the SHARED `model/feature/secrets.aontu` beside every other language's,
    // which is why this pack's manifest requires an sdkgen that carries it.
    await consumer.add('feature', consumer.bundledRef('feature', 'secrets'))
    compile(consumer)

    active = (await generateInto(consumer, {
      model: consumerModel(consumer.sdk,
        'main: kit: feature: secrets: { active: true ' +
        'plugin: { vault: active: true aws: active: true } }'),
    })).files

    plain = (await generateInto(consumer, {
      model: consumerModel(consumer.sdk),
    })).files
  })

  after(() => {
    if (null != consumer) consumer.cleanup()
  })


  // Suffix match, so an assertion names the path a reader would recognise
  // rather than the generated tree's `dart/` prefix.
  function findFile(files, suffix) {
    const hit = Object.keys(files).find((p) => p.endsWith(suffix))
    return null == hit ? null : String(files[hit])
  }


  test('active secrets emits plugin defs and trims inactive groups', () => {
    const config = findFile(active, 'lib/Config.dart')
    ok(null != config, 'dart: no lib/Config.dart generated')

    // The NAMED imports and the definitions list — the two emissions that
    // can silently no-op while everything else stays green.
    ok(/import 'feature\/secrets\/sekreto\/plugins\/hashicorp\.dart' show hashicorp;/
      .test(config),
      'dart: active vault group did not emit the hashicorp plugin import')
    // ONE file, TWO definitions: aws.dart carries awssecrets and awsparams,
    // so the imports are grouped by path or the library is imported twice.
    ok(/import 'feature\/secrets\/sekreto\/plugins\/aws\.dart' show awsparams, awssecrets;/
      .test(config),
      'dart: the two aws definitions did not share one import')
    ok(/'secrets': \[awsparams, awssecrets, boru, hashicorp\],/.test(config),
      'dart: FEATURE_PLUGINS is missing the active definitions:\n' +
      (config.match(/FEATURE_PLUGINS = <String, List<dynamic>>\{[^}]*\}/) ||
        ['(no FEATURE_PLUGINS)'])[0])
  })


  test('the vendored sekreto core survives the Copy exclude', () => {
    // Without this the tree still carries the plugins and Config still names
    // them, so every assertion above passes on a package that does not
    // compile.
    for (const core of ['sekreto/src/sekreto.dart', 'sekreto/src/providers.dart',
      'sekreto/src/support.dart', 'sekreto/src/spec.dart']) {
      ok(null != findFile(active, 'lib/feature/secrets/' + core),
        'dart: the vendored sekreto core file ' + core + ' was excluded from ' +
        'the package — check Main_dart\'s `^src/` Copy exclude is ANCHORED')
    }
    // And the copy-target dirs that exclude is FOR are still gone.
    ok(null == findFile(active, 'dart/src/feature/secrets/.gitkeep'),
      'dart: the feature-add copy-target dir leaked into the package')
  })


  test('inactive plugin groups are trimmed, shared helpers are not', () => {
    ok(null == findFile(active, 'sekreto/plugins/gcpsecrets.dart'),
      'dart: the inactive cloud group still ships gcpsecrets')
    ok(null == findFile(active, 'sekreto/plugins/secretspec.dart'),
      'dart: the inactive secretspec group still ships its CLI plugin')
    ok(null != findFile(active, 'sekreto/plugins/hashicorp.dart'),
      'dart: the ACTIVE vault group lost hashicorp')
    ok(null != findFile(active, 'sekreto/plugins/httpjson.dart'),
      'dart: the shared httpjson helper must ship with the feature core')
    // crypto.dart is THIS PORT'S SHA-256/HMAC and sigv4.dart is its only
    // caller, so it belongs to the aws group and to no other. Trimming it
    // away from an active aws group is nine `dart analyze` errors.
    ok(null != findFile(active, 'sekreto/plugins/sigv4.dart'),
      'dart: the ACTIVE aws group lost sigv4')
    ok(null != findFile(active, 'sekreto/plugins/crypto.dart'),
      'dart: the ACTIVE aws group lost crypto, which sigv4 compiles against')
  })


  test('the secrets suite is registered in the hand-listed test entry', () => {
    const main = findFile(active, 'test/main.dart')
    ok(null != main, 'dart: no test/main.dart generated')
    ok(/import 'feature\/secrets\/secrets_test\.dart' as secrets_test;/.test(main),
      'dart: the secrets suite is not imported by test/main.dart')
    ok(/secrets_test\.tests\(\);/.test(main),
      'dart: the secrets suite is imported but never RUN')
  })


  // The inactive-model baseline: no secrets machinery anywhere the feature
  // did not put it.
  //
  // The SOURCE trim is not asserted here: this harness copies the whole
  // staged tm/ tree, while a real project's `target add` drops an undeclared
  // feature before generate ever runs.
  test('an inactive secrets model emits no secrets machinery', () => {
    const config = findFile(plain, 'lib/Config.dart')
    ok(null != config, 'dart: no lib/Config.dart generated')
    ok(!/sekreto\/plugins/.test(config),
      'dart: an inactive model still emitted plugin imports')
    ok(!/import 'feature\/secrets\/SecretsFeature\.dart';/.test(config),
      'dart: an inactive model still imported the secrets feature')
    ok(/FEATURE_PLUGINS = <String, List<dynamic>>\{\s*\r?\n\};/.test(config),
      'dart: an inactive model must emit an EMPTY FEATURE_PLUGINS map')

    const main = findFile(plain, 'test/main.dart')
    ok(null != main, 'dart: no test/main.dart generated')
    ok(!/secrets_test/.test(main),
      'dart: an inactive model still registers the secrets suite, which is ' +
      'an import of a file `target add` removed')

    const sdk = findFile(plain, 'lib/DemoSDK.dart')
    ok(null != sdk, 'dart: no SDK entry generated')
    ok(!/dynamic secrets\(\)/.test(sdk),
      'dart: an inactive model still emitted the secrets() accessor')
  })


  // A consumer with the bundled `secrets` feature installed and `extra`
  // (its activation) in force BEFORE `package add`, generated once. The
  // model is compiled twice on purpose: the add actions read `actx.model`
  // and nothing recompiles it mid-process, so the copy `setModel` installs
  // has to carry the activation the later generate compiles again.
  async function generateSecrets(extra) {
    const consumer = stageConsumer({ recordLog: true })
    try {
      await consumer.add('feature', 'secrets')
      consumer.setModel(consumerModel(consumer.sdk, extra))
      await consumer.addPackage(PKG)
      consumer.compile()
      return await generateInto(consumer, { model: consumerModel(consumer.sdk, extra) })
    }
    finally {
      consumer.cleanup()
    }
  }


  // LEAN CARRIES THE SECRETS FEATURE TOO — sdkgen's own generate guard for
  // it, moved here with the target.
  //
  // lean is the one target whose feature catalog is a STATIC module
  // (src/SdkFeatures.lean), so the container-bound secrets feature reaches
  // it through three comment-marker slots Main_lean fills only when the
  // feature is active. The vendored trees are Lake srcDir roots (no import
  // adaptation at all), and the plugin groups bind libcurl through two
  // sdkgen-owned C stubs under src/feature/secrets/ffi/ — linked (a
  // response file on the lakefile, LEAN_CC and the ffi rules in the
  // Makefile) ONLY when a group is on, so the built-ins-only and inactive
  // shapes keep the target's zero-dependency promise. Three models: vault
  // on, secrets on with no group, secrets declared and off.
  //
  // As for dart, the plugin `def: lean:` maps live in sdkgen's core
  // secrets.aontu, so the first assertion names that dependency.
  test('lean: active secrets emits plugin defs and trims inactive groups', async () => {
    const P = 'lean/src/feature/secrets/sekreto/plugins/SekretoPlugins/'

    // The dependency, checked on the model before anything is generated.
    {
      const probe = stageConsumer()
      try {
        await probe.add('feature', 'secrets')
        const vault = consumerModel(probe.sdk).main.kit.feature.secrets.plugin.vault
        ok(null != vault.def && null != vault.def.lean,
          'the installed @voxgig/sdkgen ships a core secrets model with no ' +
          'lean plugin definitions (`def: lean:`), so lean\'s secrets feature ' +
          'cannot emit any — it needs the sdkgen release that carries them')
      }
      finally {
        probe.cleanup()
      }
    }

    // VAULT ON.
    const { files: out, leaks } = await generateSecrets(
      'main: kit: feature: secrets: { active: true plugin: vault: active: true }')
    deepStrictEqual(leaks.filter((l) => l.startsWith('lean/')), [],
      'lean: a placeholder survived into the secrets output')

    // The definitions list — the emission that can silently no-op while
    // everything else stays green — and the imports it needs, one per
    // module, derived from the def paths.
    const feature = out['lean/src/feature/secrets/SecretsFeature.lean']
    ok(null != feature, 'lean: the secrets feature source was not generated')
    ok(/^import SekretoPlugins\.Boru$/m.test(feature) &&
      /^import SekretoPlugins\.Hashicorp$/m.test(feature),
      'lean: the vault plugin modules are not imported:\n' +
      (feature.match(/^import [\s\S]*?^open/m) || ['(no imports)'])[0])
    ok(/^  Sekreto\.boru, Sekreto\.hashicorp$/m.test(feature),
      'lean: featurePlugins is missing the vault definitions')
    ok(!/SekretoPlugins\.(Aws|Gcpsecrets|Azuresecrets|Doppler|Infisical|Onepassword|Secretspec|Sigv4|Crypto|Clock)/
      .test(feature),
      'lean: an INACTIVE group\'s module reached SecretsFeature.lean')
    ok(!/#Secrets|ProjectName|PROJECTENV/.test(feature),
      'lean: a marker or placeholder survived in SecretsFeature.lean')

    // THE TRIM, from the file list. Lake compiles an import closure, not a
    // directory, so a file the trim left behind compiles nowhere and only
    // this test can see it. Httpjson and Proc are the two ungrouped shared
    // helpers (Boru reaches both); the BARREL is never vendored.
    for (const kind of ['Hashicorp', 'Boru', 'Httpjson', 'Proc']) {
      ok(null != out[P + kind + '.lean'],
        'lean: the ACTIVE vault group (or a shared helper) lost ' + kind)
    }
    for (const kind of ['Aws', 'Sigv4', 'Crypto', 'Clock', 'Gcpsecrets', 'Azuresecrets',
      'Onepassword', 'Doppler', 'Infisical', 'Secretspec']) {
      ok(null == out[P + kind + '.lean'],
        'lean: an INACTIVE group still ships ' + kind)
    }
    ok(null == out['lean/src/feature/secrets/sekreto/plugins/SekretoPlugins.lean'],
      'lean: the full-set barrel SekretoPlugins.lean must never ship')
    for (const core of ['sekreto/Sekreto.lean', 'sekreto/Sekreto/Chain.lean',
      'plugin/Plugin.lean', 'plugin/Plugin/Host.lean',
      'ffi/sekreto_curl.c', 'ffi/sekreto_clock.c']) {
      ok(null != out['lean/src/feature/secrets/' + core],
        'lean: ' + core + ' did not reach the SDK')
    }

    // REGISTERED: the three marker slots in the static catalog, filled, and
    // no marker text left behind.
    const catalog = out['lean/src/SdkFeatures.lean']
    ok(null != catalog, 'lean: no src/SdkFeatures.lean generated')
    ok(/^import SecretsFeature$/m.test(catalog) &&
      /^  \| "secrets" => SecretsFeature\.secretsFeature$/m.test(catalog) &&
      /^    , "secrets"$/m.test(catalog),
      'lean: SdkFeatures.lean does not import, construct and list the secrets feature:\n' +
      catalog.split('\n').filter((l) => /secrets|Secrets/.test(l)).join('\n'))
    ok(!/#Secrets/.test(catalog), 'lean: a marker survived in SdkFeatures.lean')

    // The build: the four libs, the suite's executable, and the libcurl link
    // through the response file `make ffi` writes; the Makefile runs the
    // suite, sets LEAN_CC and carries the ffi rules.
    const lake = out['lean/lakefile.toml']
    ok(null != lake, 'lean: no lakefile.toml generated')
    for (const lib of ['Plugin', 'Sekreto', 'SekretoPlugins', 'SecretsFeature']) {
      ok(new RegExp('^name = "' + lib + '"$', 'm').test(lake),
        'lean: lakefile.toml declares no lean_lib ' + lib)
    }
    ok(/^name = "secrets"\nsrcDir = "test\/feature\/secrets"\nroot = "TSecrets"$/m.test(lake),
      'lean: lakefile.toml has no `secrets` executable rooted at TSecrets')
    ok(/^moreLinkArgs = \["@src\/feature\/secrets\/ffi\/link\.rsp"\]$/m.test(lake),
      'lean: the vault group is on but lakefile.toml does not link the ffi response file')
    const mk = out['lean/Makefile']
    ok(null != mk, 'lean: no Makefile generated')
    ok(/^\tlake exe secrets$/m.test(mk), 'lean: `make test` does not run `lake exe secrets`')
    ok(/^export LEAN_CC \?= cc$/m.test(mk) && /-lcurl -lssl -lcrypto/.test(mk) &&
      /^ffi: \$\(SECRETS_FFI\)$/m.test(mk),
      'lean: the Makefile lacks the ffi rules a plugin group needs')
    ok(!/#Secrets/.test(mk), 'lean: a marker survived in the Makefile')
    const suite = out['lean/test/feature/secrets/TSecrets.lean']
    ok(null != suite, 'lean: the gated secrets suite was not generated')
    ok(!/ProjectName|PROJECTENV/.test(suite), 'lean: a placeholder survived in TSecrets.lean')

    // Scaffolding for the neutral feature tooling never reaches an SDK.
    deepStrictEqual(Object.keys(out).filter((p) => /\.gitkeep$|src\/feature\/README\.md$/.test(p)), [],
      'lean: .gitkeep placeholders or the container README leaked into the SDK')

    // BUILT-INS ONLY: secrets on, no group. The feature and its suite ship,
    // the vendored cores ship, the shared helpers ship — and NOTHING binds
    // libcurl: no response file on the lakefile, no LEAN_CC, no ffi rules.
    const { files: bout } = await generateSecrets(
      'main: kit: feature: secrets: { active: true }')
    const bfeature = bout['lean/src/feature/secrets/SecretsFeature.lean']
    ok(null != bfeature && !/^import SekretoPlugins\./m.test(bfeature) &&
      /featurePlugins : List Plugin\.Definition := \[\n  \n  \]/.test(bfeature),
      'lean: built-ins only must import no plugin module and list no definition')
    ok(null != bout[P + 'Httpjson.lean'] && null == bout[P + 'Hashicorp.lean'],
      'lean: built-ins only keeps the shared helpers and trims every kind')
    const blake = bout['lean/lakefile.toml']
    ok(/^name = "SecretsFeature"$/m.test(blake) && !/moreLinkArgs|link\.rsp/.test(blake),
      'lean: built-ins only must ship the feature lib and must NOT link libcurl')
    const bmk = bout['lean/Makefile']
    // Anchored on RULE lines: the static Makefile's prose names LEAN_CC and
    // -lcurl while explaining why they are absent.
    ok(/^\tlake exe secrets$/m.test(bmk) &&
      !/^export LEAN_CC|^SECRETS_FFI_OBJS :=|^\$\(SECRETS_FFI_RSP\):/m.test(bmk) &&
      /^ffi: \$\(SECRETS_FFI\)$/m.test(bmk),
      'lean: built-ins only must run the suite and define no ffi rules (ffi stays a no-op)')

    // DECLARED AND OFF. The container is trimmed (srcFeatureExcludes —
    // declared-but-inactive is the case it exists for; lean's target model
    // keeps `feature.trim: false`, so `target add` leaves every feature's
    // source in place and this generate-time exclude is the trim), the
    // markers are blank, and lakefile and Makefile carry nothing of it.
    const { files: off } = await generateSecrets(
      'main: kit: feature: secrets: { active: false }')
    deepStrictEqual(Object.keys(off).filter((p) => /src\/feature\/secrets\//.test(p)), [],
      'lean: an inactive model still ships the secrets container')
    const offclean = (files, label) => {
      const cat = files['lean/src/SdkFeatures.lean']
      ok(null != cat && !/SecretsFeature|"secrets"|#Secrets/.test(cat),
        'lean: ' + label + ' still registers the secrets feature in SdkFeatures.lean')
      const lk = files['lean/lakefile.toml']
      ok(null != lk && !/Sekreto|SecretsFeature|secrets|moreLinkArgs/.test(lk),
        'lean: ' + label + ' still declares secrets libs in lakefile.toml')
      const m = files['lean/Makefile']
      ok(null != m && !/^\tlake exe secrets$|^export LEAN_CC|#Secrets/m.test(m) &&
        /^ffi: \$\(SECRETS_FFI\)$/m.test(m),
        'lean: ' + label + ' still runs the secrets suite or carries ffi rules')
    }
    offclean(off, 'an inactive model')

    // And this suite's own shared consumer, which HAS the feature installed
    // but never activates it in its model: the same three files must be
    // clean there too. (In sdkgen this was the whole-suite consumer, which
    // had no feature added at all; here the stronger case is the one that
    // has the sources on disk and still must emit none of them.)
    offclean(plain, 'a model without the feature')
  })
})


// The request-shaping utilities route a header, cookie or query argument the
// way sdkgen's bundled targets do (voxgig/sdkgen#327, #331, #28 here), checked
// on the templates as sdkgen's pathquery.test.ts checks its own.
describe('argument routing in the templates', () => {
  const TM = Path.join(PKG, '.sdk', 'tm')

  const ROUTING = {
    dart: {
      headers: ['dart/lib/utility/PrepareHeadersUtility.dart', 'dynamic prepareHeaders('],
      query: ['dart/lib/utility/PrepareQueryUtility.dart', 'dynamic prepareQuery('],
      body: ['dart/lib/utility/TransformRequestUtility.dart', 'dynamic transformRequest('],
    },
    haskell: {
      headers: ['haskell/src/SdkRuntime.hs', 'prepareHeadersUtil :: '],
      query: ['haskell/src/SdkRuntime.hs', 'prepareQueryUtil :: '],
      body: ['haskell/src/SdkRuntime.hs', 'transformRequestUtil :: '],
    },
    lean: {
      headers: ['lean/src/SdkUtility.lean', 'def prepareHeaders '],
      query: ['lean/src/SdkUtility.lean', 'def prepareQuery '],
      body: ['lean/src/SdkUtility.lean', 'def transformRequest '],
    },
  }

  // The definition's body, as far as the next few definitions.
  function body(lang, part) {
    const [rel, def] = ROUTING[lang][part]
    const src = Fs.readFileSync(Path.join(TM, rel), 'utf8')
    const at = src.indexOf(def)
    ok(-1 !== at, lang + ': no ' + part + ' definition in ' + rel)
    return src.slice(at, at + 3000)
  }

  const calls = (kind) => new RegExp('callArgs\\W{1,4}ctx\\W{1,4}[\'"]' + kind + '[\'"]')

  for (const lang of Object.keys(ROUTING)) {
    test(lang + ': prepareHeaders sends the header and cookie arguments and the media headers', () => {
      const src = body(lang, 'headers')
      ok(calls('header').test(src), lang + ': prepareHeaders reads no header arguments')
      ok(calls('cookie').test(src), lang + ': prepareHeaders reads no cookie arguments')
      ok(/cookiePair/.test(src) && /cookieKeep/.test(src),
        lang + ': prepareHeaders does not pair the cookies or read the cookie header')
      ok(/mediaHeaders/.test(src), lang + ': prepareHeaders sets no media headers')
    })

    test(lang + ': prepareQuery keeps path, header and cookie arguments out, and sends a query argument under its orig', () => {
      const src = body(lang, 'query')
      for (const kind of ['params', 'header', 'cookie', 'query']) {
        ok(new RegExp('[\'"]' + kind + '[\'"]').test(src), lang + ': prepareQuery never reads args.' + kind)
      }
      ok(/\borig\b/.test(src), lang + ': prepareQuery never maps a query argument to its orig')
      ok(calls('query').test(src), lang + ': prepareQuery reads only the match')
    })

    test(lang + ': transformRequest builds the body without the routed arguments', () => {
      ok(/routedArgNames/.test(body(lang, 'body')), lang + ': transformRequest keeps the routed arguments')
    })
  }
})


describe('the test mock in the templates', () => {
  const TM = Path.join(PKG, '.sdk', 'tm')

  // Where each mock wraps a listed record under the key its transform reads.
  const WRAP = {
    dart: ['dart/lib/feature/test/TestFeature.dart', '<String, dynamic>{itemkey: item}'],
    haskell: ['haskell/src/SdkFeatures.hs', 'jo [(k, i)]'],
    lean: ['lean/src/SdkRuntime.lean', 'newMap #[(key, item)]'],
  }

  for (const [lang, [rel, form]] of Object.entries(WRAP)) {
    test(lang + ': the test mock wraps each listed record under its key', () => {
      const src = Fs.readFileSync(Path.join(TM, rel), 'utf8')
      ok(src.includes(form), lang + ': the test mock answers wrapped list items bare (' + rel + ')')
    })
  }
})
