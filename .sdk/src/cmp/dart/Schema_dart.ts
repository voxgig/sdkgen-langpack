
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

import { dartValue } from './utility_dart'


// The client option spec, from `main.kit.optspec`. The feature half takes any
// option a feature declares: sdkgen writes each feature's spec as a NOF union,
// which the vendored struct port here does not read.
const Schema = cmp(function Schema(props: any) {
  const { target, ctx$: { model } } = props

  const optspec = {
    ...JSON.parse(JSON.stringify(getModelPath(model, `main.${KIT}.optspec`,
      { required: false, only_active: false }) || {})),
    feature: { '`$CHILD`': { '`$OPEN`': true, active: false } },
  }

  File({ name: 'Schema.' + target.ext }, () => {
    Content(`// ${model.const.Name} ${fact(target, 'title')} SDK: the client option spec. Generated; do not edit.
//
// From the model's \`main.kit.optspec\`; makeOptions validates the options
// against it.

Map<String, dynamic> makeOptspec() => ${dartValue(optspec)};
`)
  })
})


export {
  Schema
}
