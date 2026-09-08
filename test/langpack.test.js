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

const { Aontu } = require('aontu')

const { names } = require('@voxgig/sdkgen')
const { stageConsumer, generateInto } = require('@voxgig/sdkgen/testkit')


const PKG = Path.resolve(__dirname, '..')

// The targets this package provides, read from the manifest rather than
// restated. A target added to the pack without a line here would otherwise
// join with no coverage at all — the silently-absent shape.
const TARGETS = require('../sdkgen-package.json').provides.target


// The API every target is generated from. Small, but carrying the shapes that
// have historically broken generation: a required and an optional field, an
// entity with an id binding, more than one operation, and a flow (several
// targets' test emitters read one and throw without it).
const API = `
main: kit: info: { title: 'Demo', version: '1.0.0', auth: false }
main: kit: config: headers: { 'content-type': 'application/json' }

main: kit: entity: planet: {
  alias: field: {}
  name: "planet"
  id: { field: "id", name: "id" }
  field: {
    id:     { name: "id",     kind: "field", type: "\`$STRING\`", required: true }
    title:  { name: "title",  kind: "field", type: "\`$STRING\`", required: true }
    radius: { name: "radius", kind: "field", type: "\`$NUMBER\`" }
  }
  fields: [
    { name: "id",     req: true,  type: "\`$STRING\`" }
    { name: "radius", req: false, type: "\`$NUMBER\`" }
    { name: "title",  req: true,  type: "\`$STRING\`" }
  ]
  op: {
    list: {
      name: "list"
      points: [ {
        args: {}, method: "GET", orig: "/planet", segments: [{ lit: "planet" }]
        transform: { req: "\`reqdata\`", res: "\`body\`" }
      } ]
    }
    load: {
      name: "load"
      points: [ {
        args: { params: [
          { kind: "param", name: "id", orig: "id", reqd: true, type: "\`$STRING\`", example: "p01" }
        ] }
        method: "GET", orig: "/planet/{id}", segments: [{ lit: "planet" }, { var: "id" }]
        transform: { req: "\`reqdata\`", res: "\`body\`" }
      } ]
    }
  }
}

main: kit: flow: BasicPlanetFlow: {
  entity: "planet", kind: "basic", name: "BasicPlanetFlow"
  step: [
    { op: "list" }
    { op: "load", input: {
        ref: "planet_ref01", srcdatavar: "planet_ref01_data", suffix: "_dt0" } }
  ]
}
`


function consumerModel(sdk, extra) {
  const src = [
    '@"@voxgig/apidef/model/apidef.aon"',
    '@"@voxgig/sdkgen/model/sdkgen.aon"',
    '@"target/target-index.aon"',
    '@"feature/feature-index.aon"',
    "name: 'demo'",
    API,
    extra || '',
  ].join('\n')

  const path = Path.join(sdk, 'model', 'generate-test.aon')
  Fs.writeFileSync(path, src)

  const errs = []
  const model = new Aontu().generate(src, { path, errs })
  strictEqual(errs.length, 0,
    'model did not compile: ' + errs.map((e) => e.msg).join(' | '))

  // `const.Name` is what the ADD ACTIONS substitute for `ProjectName` when
  // they copy a template tree into the consumer (helpers/stdrep
  // templateReplacements). A model installed with `setModel` and lacking it
  // makes `package add` write `import '../lib/SDK.dart'` into every copied
  // test, which nothing here notices until `dart analyze` runs over the tree.
  // generateInto's own Root sets the same fields when absent, so generation
  // is unchanged by this.
  model.const = { name: model.name }
  names(model.const, model.name)

  return model
}


describe('sdkgen-langpack', () => {

  let consumer
  let generated

  before(async () => {
    consumer = stageConsumer({ recordLog: true })
    await consumer.addPackage(PKG)
    consumer.compile()

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
      ok(files.includes('model/target/' + t + '.aon'), t + ': no target model')
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


  // DART CARRIES THE SECRETS FEATURE (a vendored sekreto port under
  // tm/dart/lib/feature/secrets, declared by `provides: { sekreto: true }`).
  // This is sdkgen's own `generate.test.ts` guard for it, moved here with the
  // target — with one difference stated at the end.
  //
  // An ACTIVE secrets model must emit the `show` imports and the
  // FEATURE_PLUGINS entries into lib/Config.dart, and the INACTIVE groups'
  // vendored files must stay out of the tree (Main_dart's pluginExcludes),
  // while the shared httpjson helper (in no group) ships regardless.
  //
  // FIRST DART HAZARD: the whole sekreto CORE lives at `sekreto/src/*.dart`,
  // upstream's layout. Main_dart's Copy excluded `/src\//` unanchored — for
  // the `tm/dart/src/feature/<name>/` copy-target dirs — and that pattern
  // matched the vendored core too, so the entire secrets library was dropped
  // from the package while the plugins beside it survived. `dart analyze`
  // reported it as undefined symbols in httpjson.dart, naming nothing that
  // would lead you to the Copy.
  //
  // SECOND DART HAZARD: test/main.dart is a HAND-LISTED suite entry — dart
  // has no `go test ./...` or pytest discovery — so the secrets suite must be
  // registered there or it ships and never runs, with the lane green.
  //
  // THE PLUGIN DEFINITIONS COME FROM SDKGEN'S CORE FEATURE MODEL, not from
  // this package: `model/feature/secrets.aon` carries dart's `path` lists and
  // `def: dart:` maps, and packs consume core feature models rather than
  // copying them. So this test can only pass against an sdkgen whose core
  // model has those entries — the first assertion says so by name, rather
  // than letting the later ones fail as an unexplained missing import.
  test('dart: active secrets emits plugin defs and trims inactive groups', async () => {
    // Its OWN staged consumer, because the feature has to be declared and
    // ACTIVE before `package add` runs: `target add` trims feature source
    // down to what the model it sees selects, so a target added against the
    // suite's shared (secrets-less) consumer ships none of it.
    const extra = 'main: kit: feature: secrets: { active: true ' +
      'plugin: { vault: active: true aws: active: true } }'

    const secrets = stageConsumer({ recordLog: true })
    try {
      // The bundled feature, from sdkgen core — the same `feature add` a
      // consumer runs.
      await secrets.add('feature', 'secrets')

      const model = consumerModel(secrets.sdk, extra)

      const vault = model.main.kit.feature.secrets.plugin.vault
      ok(null != vault.def && null != vault.def.dart,
        'the installed @voxgig/sdkgen ships a core secrets model with no ' +
        'dart plugin definitions (`def: dart:`), so dart\'s secrets feature ' +
        'cannot emit any — it needs the sdkgen release that carries them')

      secrets.setModel(model)
      await secrets.addPackage(PKG)
      secrets.compile()

      const { files, leaks } = await generateInto(secrets, {
        model: consumerModel(secrets.sdk, extra),
      })

      deepStrictEqual(leaks.filter((l) => l.startsWith('dart/')), [],
        'dart: a placeholder survived into the secrets output')

      const config = files['dart/lib/Config.dart']
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

      // The vendored CORE survived the Copy exclude. Without this the tree
      // still carries the plugins and Config still names them, so every
      // assertion above passes on a package that does not compile.
      for (const core of ['sekreto.dart', 'providers.dart', 'support.dart', 'spec.dart']) {
        ok(null != files['dart/lib/feature/secrets/sekreto/src/' + core],
          'dart: the vendored sekreto core file sekreto/src/' + core +
          ' was excluded from the package — check Main_dart\'s `^src/` Copy ' +
          'exclude is ANCHORED')
      }
      // And the copy-target dirs that exclude is FOR are still gone.
      ok(!Object.keys(files).some((p) => p.startsWith('dart/src/')),
        'dart: the feature-add copy-target dir leaked into the package')

      // The trim: an inactive group's vendored file is OUT, the active
      // groups' and the group-less shared helper are IN.
      const plugin = (n) => files['dart/lib/feature/secrets/sekreto/plugins/' + n]
      ok(null == plugin('gcpsecrets.dart'),
        'dart: the inactive cloud group still ships gcpsecrets')
      ok(null == plugin('secretspec.dart'),
        'dart: the inactive secretspec group still ships its CLI plugin')
      ok(null != plugin('hashicorp.dart'),
        'dart: the ACTIVE vault group lost hashicorp')
      ok(null != plugin('httpjson.dart'),
        'dart: the shared httpjson helper must ship with the feature core')
      // crypto.dart is THIS PORT'S SHA-256/HMAC and sigv4.dart is its only
      // caller, so it belongs to the aws group and to no other. Trimming it
      // away from an active aws group is nine `dart analyze` errors.
      ok(null != plugin('sigv4.dart'), 'dart: the ACTIVE aws group lost sigv4')
      ok(null != plugin('crypto.dart'),
        'dart: the ACTIVE aws group lost crypto, which sigv4 compiles against')

      // REGISTERED in the hand-listed suite entry, or it never runs.
      const main = files['dart/test/main.dart']
      ok(null != main, 'dart: no test/main.dart generated')
      ok(/import 'feature\/secrets\/secrets_test\.dart' as secrets_test;/.test(main),
        'dart: the secrets suite is not imported by test/main.dart')
      ok(/secrets_test\.tests\(\);/.test(main),
        'dart: the secrets suite is imported but never RUN')

      // The accessor on the SDK entry, emitted only for an active feature.
      const sdk = files['dart/lib/DemoSDK.dart']
      ok(null != sdk, 'dart: no SDK entry generated')
      ok(/dynamic secrets\(\)/.test(sdk),
        'dart: an active model did not emit the secrets() accessor')
    }
    finally {
      secrets.cleanup()
    }

    // And the baseline, from the suite's shared consumer, whose model never
    // mentions the feature: no secrets machinery anywhere the feature did not
    // put it.
    const plain = generated.files['dart/lib/Config.dart']
    ok(!/sekreto\/plugins/.test(plain),
      'dart: an inactive model still emitted plugin imports')
    ok(!/import 'feature\/secrets\/SecretsFeature\.dart';/.test(plain),
      'dart: an inactive model still imported the secrets feature')
    ok(/FEATURE_PLUGINS = <String, List<dynamic>>\{\s*\r?\n\};/.test(plain),
      'dart: an inactive model must emit an EMPTY FEATURE_PLUGINS map')
    const plainmain = generated.files['dart/test/main.dart']
    ok(!/secrets_test/.test(plainmain),
      'dart: an inactive model still registers the secrets suite, which is ' +
      'an import of a file `target add` removed')
    const plainsdk = generated.files['dart/lib/DemoSDK.dart']
    ok(null != plainsdk, 'dart: no SDK entry generated')
    ok(!/dynamic secrets\(\)/.test(plainsdk),
      'dart: an inactive model still emitted the secrets() accessor')

    // THE DIFFERENCE FROM SDKGEN'S COPY OF THIS TEST. Its harness copied the
    // whole staged tm/ tree, so it could not assert the SOURCE trim. This
    // suite installs through the real `package add`, which is exactly the
    // path that drops an undeclared feature's source — so here the baseline
    // tree must carry no secrets source at all, not merely no references to
    // it.
    deepStrictEqual(
      Object.keys(generated.files).filter((p) => p.startsWith('dart/lib/feature/secrets/')),
      [],
      'dart: a model without the feature still received the vendored ' +
      'secrets source — the add-time feature trim did not run')
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
  // secrets.aon, so the first assertion names that dependency.
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

    // And the suite's shared consumer, whose model never mentions the
    // feature: the same three files must be clean there too.
    offclean(generated.files, 'a model without the feature')
  })
})
