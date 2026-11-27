import {
  Content,
  File,
  cmp,
  each,
  targetFeatures,
  configDefinition,
} from '@voxgig/sdkgen'

import {
  Model,
} from '@voxgig/apidef'

import {
  leanString,
} from './utility_lean'


// SdkConfig.lean: the embedded API model, serialised to a JSON string. The
// config-driven runtime (SdkRuntime) parses it into a struct `Value` at client
// construction — the whole SDK is data-driven, so there is no per-entity code.
const Config = cmp(async function Config(props: any) {
  const ctx$ = props.ctx$
  const target = props.target

  const model: Model = ctx$.model

  const { def: configDef } = configDefinition(model, target.name)
  // Gated by the applicability tags, so this target never imports or
  // registers a feature it has no source for. One rule, one place:
  // helpers/applicability.
  const feature = targetFeatures(model, target)
  const featureConfig: any = {}
  each(feature, (f: any) => { featureConfig[f.name] = f.config || {} })

  // The options, server defaults and credential placement included, are
  // configDefinition's, as every other target's config carries them.
  const config = {
    main: { name: model.const.Name },
    feature: featureConfig,
    options: configDef.options,
    entity: configDef.entity,
  }

  File({ name: 'SdkConfig.' + target.ext }, () => {
    Content(`-- Generated API configuration for the config-driven runtime.
-- The embedded model is parsed into a struct Value at client construction.

namespace SdkConfig

def configJson : String :=
  ${leanString(JSON.stringify(config))}

end SdkConfig
`)
  })
})


export {
  Config
}
