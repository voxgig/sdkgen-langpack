
import * as Path from 'node:path'

import { cmp, Content, isPublished, repoInfo, packageVersion, readerDir, registryNote, fact } from '@voxgig/sdkgen'

import { dartPackageName } from './Package_dart'


const ReadmeInstall = cmp(function ReadmeInstall(props: any) {
  const { target, ctx$ } = props
  const { model } = ctx$

  const pkg = dartPackageName(model, target.name)

  if (isPublished(model, target.name)) {
    Content(`\`\`\`bash
dart pub add ${pkg}
\`\`\`

Or add it to your \`pubspec.yaml\`:

\`\`\`yaml
dependencies:
  ${pkg}: ^${packageVersion(model, target.name)}
\`\`\`

`)
    return
  }

  // Publish pending: not yet on pub.dev. Depend on it via the git release
  // tag, or from a local path checkout.
  const { hostName, repo, repoUrl, tagsUrl } = repoInfo(model, target.name)
  const tag = fact(target, 'tag')
  const dir = readerDir(target)
  Content(`${registryNote(model, target.name)}${'' === tag ? ' Depend on it' : ` Add it as a git
dependency, pinned to a ${hostName} release tag (\`${tag}X.Y.Z\`, see
[Tags](${tagsUrl})), in your \`pubspec.yaml\`:

\`\`\`yaml
dependencies:
  ${pkg}:
    git:
      url: ${repoUrl}${'.' === dir ? '' : `
      path: ${dir}`}
      ref: ${tag}${packageVersion(model, target.name)}
\`\`\`

Or depend on it`} from a local source checkout:

\`\`\`yaml
dependencies:
  ${pkg}:
    path: ${Path.posix.join('..', repo, dir)}
\`\`\`

`)
})


export {
  ReadmeInstall
}
