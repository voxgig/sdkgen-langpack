
import { cmp, Content, isPublished, repoInfo, cdTarget, collectDeps, registryNote, fact } from '@voxgig/sdkgen'

import { pkgName } from './utility_haskell'


const ReadmeInstall = cmp(function ReadmeInstall(props: any) {
  const { target, ctx$ } = props
  const { model } = ctx$
  const free = 0 === collectDeps(model, target.name, target.deps).length

  if (isPublished(model, target.name)) {
    Content(`\`\`\`bash
cabal install ${pkgName(model)}
\`\`\`

Or build from a source checkout with the bundled Makefile${free ? ` (stock GHC, no
third-party dependencies — only the GHC boot libraries)` : ''}:

\`\`\`bash
${cdTarget(target)}make test
\`\`\`

`)
    return
  }

  // Publish pending: not yet on Hackage. Build from the git release tag or
  // from a local source checkout.
  const { hostName, tagsUrl } = repoInfo(model, target.name)
  const tag = fact(target, 'tag')
  // sdkgen names a registry it has no label for by its model name.
  const note = registryNote(model, target.name).replace(/\bhackage\.$/, 'Hackage.')
  Content(`${note} Install it from ${'' === tag ? '' : `the ${hostName}
release tag (\`${tag}X.Y.Z\`, see [Tags](${tagsUrl})) or from `}a source checkout${free ? `. The
runtime has no third-party dependencies (only the GHC boot libraries:
\`base\`, \`containers\`, \`array\`, \`time\`), so the bundled Makefile drives
stock GHC with no cabal solve` : ', with the bundled Makefile'}:

\`\`\`bash
${cdTarget(target)}make test
\`\`\`

The generated \`${pkgName(model)}.cabal\` builds it with \`cabal\` or \`stack\`:

\`\`\`bash
${cdTarget(target)}cabal build
\`\`\`

`)
})


export {
  ReadmeInstall
}
