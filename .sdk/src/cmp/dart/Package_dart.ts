
import {
  Content,
  File,
  cmp,
  collectDeps,
  pkgDescription,
  keywords,
  repoInfo,
  packageVersion,
} from '@voxgig/sdkgen'


import {
  KIT,
} from '@voxgig/apidef'

import type {
  Model,
} from '@voxgig/apidef'


// The name the target's model declares, which sdkgen's packageName reads too;
// else the project's name as a pub.dev identifier ([a-z0-9_], from a letter).
function dartPackageName(model: any, target: string): string {
  const declared = model?.main?.[KIT]?.target?.[target]?.publish?.registry?.package
  if (null != declared && '' !== declared) {
    return String(declared)
  }
  let name = `${model.name}_sdk`.toLowerCase().replace(/[^a-z0-9_]/g, '_')
  if (!/^[a-z]/.test(name)) {
    name = 'sdk_' + name
  }
  return name
}


const Package = cmp(async function Package(props: any) {
  const ctx$ = props.ctx$
  const target = props.target

  const model: Model = ctx$.model

  const { repoUrl, issuesUrl } = repoInfo(model)
  const kw = keywords(model)

  File({ name: 'pubspec.yaml' }, () => {
    Content(`name: ${dartPackageName(model, target.name)}
description: >-
  ${pkgDescription(model, target.name)}
version: ${packageVersion(model, target.name)}
homepage: ${repoUrl}
repository: ${repoUrl}
issue_tracker: ${issuesUrl}
topics:
`)

    // pub.dev topics: max 5, lowercase, hyphenated.
    kw.slice(0, 5).forEach((k: string) => {
      Content(`  - ${String(k).toLowerCase().replace(/[^a-z0-9-]/g, '-')}
`)
    })

    Content(`environment:
  sdk: '>=3.0.0 <4.0.0'
`)

    // Runtime is dependency-free (dart:io + dart:convert + vendored struct);
    // target/feature deps, when declared, land here.
    const deps: Record<string, string> = {}
    for (const d of collectDeps(model, target.name, target.deps, ctx$.log)) {
      deps[d.name] = d.source === 'target' ? (d.version || 'any') : d.version
    }

    if (0 < Object.keys(deps).length) {
      Content(`dependencies:
`)
      for (const [name, version] of Object.entries(deps)) {
        Content(`  ${name}: '${version}'
`)
      }
    }
  })
})


export {
  Package,
  dartPackageName,
}
