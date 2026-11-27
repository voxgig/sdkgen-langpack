import {
  Content,
  File,
  cmp,
  fact,
} from '@voxgig/sdkgen'

import {
  KIT,
  getModelPath,
} from '@voxgig/apidef'

import { formatHsValue } from './utility_haskell'


// SdkSchema.hs: the client option spec, from `main.kit.optspec`. The feature
// half takes any option a feature declares: sdkgen writes each feature's spec
// as a NOF union, which the vendored struct port here does not read.
const Schema = cmp(function Schema(props: any) {
  const { target, ctx$: { model } } = props

  const optspec = {
    ...JSON.parse(JSON.stringify(getModelPath(model, `main.${KIT}.optspec`,
      { required: false, only_active: false }) || {})),
    feature: { '`$CHILD`': { '`$OPEN`': true, active: false } },
  }

  File({ name: 'SdkSchema.' + target.ext }, () => {
    Content(`-- ${model.const.Name} ${fact(target, 'title')} SDK: the client option spec. Generated; do not edit.
--
-- From the model's \`main.kit.optspec\`; makeOptions validates the options
-- against it.

module SdkSchema (optSpec) where

import VoxgigStruct (Value)
import SdkHelpers (CV (..), buildCV)

optSpec :: IO Value
optSpec = buildCV ${formatHsValue(optspec)}
`)
  })
})


export {
  Schema
}
