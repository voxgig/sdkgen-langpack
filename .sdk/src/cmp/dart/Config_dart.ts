
import * as Path from 'node:path'


import {
  File,
  Fragment,
  Line,
  cmp,
  configDefinition,
  configReprSetting,
  each,
  isConfigData,
  isAuthActive,
  resolveAuthPrefix,
  targetFeatures,
} from '@voxgig/sdkgen'


import {
  KIT,
  Model,
  getModelPath,
  nom,
} from '@voxgig/apidef'


import {
  dartStringLiteral,
  dartValue,
} from './utility_dart'


const Config = cmp(async function Config(props: any) {
  const ctx$ = props.ctx$
  const target = props.target

  const model: Model = ctx$.model

  const entity = getModelPath(model, `main.${KIT}.entity`)
  // Gated by the applicability tags, so this target never imports or
  // registers a feature it has no source for. One rule, one place:
  // helpers/applicability.
  const feature = targetFeatures(model, target)

  const ff = Path.normalize(__dirname + '/../../../src/cmp/dart/fragment/')

  const headers = getModelPath(model, `main.${KIT}.config.headers`) || {}

  const authActive = isAuthActive(model)
  // config.auth.prefix override -> spec-derived info.security.prefix -> 'Bearer'
  const authPrefix = resolveAuthPrefix(model)
  const authBlock = authActive
    ? `'auth': <String, dynamic>{
      'prefix': '${authPrefix}',
    },

    `
    : ''

  // Read the base URL here rather than leaving it to a `$$...$$` stdrep
  // placeholder in the fragment. stdrep can only substitute a path the model
  // actually has: a model with no `info.servers` left the placeholder itself in
  // the generated source, so `options.base` came out as the literal string
  // '$main.kit.info.servers.0.url$'. Reading it explicitly yields '' in that
  // case, which is what every other target already emits, and is identical to
  // the old output whenever the model does define a server. Same defect, and
  // same fix, as ts and js.
  let baseUrl = ''
  try {
    baseUrl = getModelPath(model, `main.${KIT}.info.servers.0.url`)
  } catch (_e) { }

  // The same config as an OBJECT, built by the shared helper so this target's
  // literal and the data that replaces it above the threshold are the same
  // config by construction. The JSON is what the threshold is measured on -
  // emitted source size varies by language, the model does not. Passing
  // target.name opts this target into the main slug/version/target identity
  // fields (read by station's descriptor - see configDefinition).
  const { def: configDef, json: configJson } = configDefinition(model, target.name)
  const asData = isConfigData(configJson, configReprSetting(model))

  File({ name: 'Config.' + target.ext }, () => {

    // ABOVE THE THRESHOLD: emit the model as DATA.
    //
    // `jsonDecode` yields exactly what the literal declared - Map<String,
    // dynamic> for objects, List<dynamic> for arrays, and int for a whole
    // number where Dart source would also have written an int - so the fields
    // keep their types and callers cannot tell the representations apart.
    if (asData) {
      Fragment({
        from: ff + 'Config.data.fragment.dart',

        replace: {
          ...ctx$.stdrep,

          '// #ImportFeatures': () => each(feature, (f: any) => {
            Line(`import 'feature/${f.name}/${nom(f, 'Name')}Feature.dart';`)
          }),

          '// #FeatureClasses': () => each(feature, (f: any) => {
            Line(`  '${f.name}': () => ${nom(f, 'Name')}Feature(),`)
          }),

          "'CONFIGJSON'": dartStringLiteral(configJson),
        }
      })
      return
    }

    Fragment({
      from: ff + 'Config.fragment.dart',

      replace: {

        // Config.fragment.dart carries `'name': 'ProjectName'` — without the
        // standard replacements the generated SDK reports "ProjectName" as its
        // own name at runtime. Every sibling dart component already spreads
        // these; this one did not.
        ...ctx$.stdrep,

        // Identity beyond the camel Name: slug/version/target (station
        // descriptor inputs). Values from configDefinition's def, not
        // re-derived here, so the literal rep and the data rep cannot
        // disagree (the Config_ts #MainMeta discipline).
        '// #MainMeta': () => {
          Line(`    'slug': ${dartValue(configDef.main.slug)},`)
          Line(`    'version': ${dartValue(configDef.main.version)},`)
          Line(`    'target': ${dartValue(configDef.main.target)},`)
        },

        // The whole options map from the canonical definition. Assembling it
        // slot by slot lost `options.server` entirely, so a spec with a
        // templated server URL described a different config either side of the
        // threshold.
        "'OPTIONSMAP'": dartValue(configDef.options, 1),

        '// #ImportFeatures': () => each(feature, (f: any) => {
          Line(`import 'feature/${f.name}/${nom(f, 'Name')}Feature.dart';`)
        }),

        '// #FeatureClasses': () => each(feature, (f: any) => {
          // Trailing comma: the map has one entry per feature, so entries
          // must be comma-separated (a single feature hid this until now).
          Line(`  '${f.name}': () => ${nom(f, 'Name')}Feature(),`)
        }),

        // Rendered from configDefinition's def, not from f.config, so the
        // literal carries the feature's `transport` role (station design
        // §8.4) beside its options and cannot drift from the data rep.
        '// #FeatureConfigs': () => each(feature, (f: any) => {
          Line(`    '${f.name}': ${dartValue(configDef.feature[f.name], 2)},`)
        }),


        '// #EntityConfigs': () => each(entity, (entity: any) => {
          Line(`      '${entity.name}': <String, dynamic>{},`)
        }),

        // configDefinition's `def.entity` verbatim, NOT rebuilt here. This
        // reduce was a second copy of that function's entityDefs loop, and
        // when configDefinition started reconstructing a point's `parts`
        // from apidef's segment vector (its ADR-003), only the data
        // representation got it — the literal one emitted empty paths. The
        // config-repr equivalence test caught it, which is what it is for.
        "'ENTITYMAP'": dartValue(configDef.entity, 1),
      }
    })
  })
})


export {
  Config
}
