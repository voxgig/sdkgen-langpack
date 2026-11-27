import { cmp, Content, isPublished, repoInfo, cdTarget, registryNote, fact } from '@voxgig/sdkgen'

const ReadmeInstall = cmp(function ReadmeInstall(props: any) {
  const { target, ctx$ } = props
  const { model } = ctx$

  if (isPublished(model, target.name)) {
    Content(`\`\`\`bash
${cdTarget(target)}lake build
\`\`\`

`)
    return
  }

  const { hostName, tagsUrl } = repoInfo(model, target.name)
  const tag = fact(target, 'tag')
  // sdkgen names a registry it has no label for by its model name.
  const note = registryNote(model, target.name)
    .replace(/\breservoir\.$/, '[Reservoir](https://reservoir.lean-lang.org).')
  Content(`${note}
Install it from ${'' === tag ? '' : `the ${hostName} release tag (\`${tag}X.Y.Z\`, see
[Tags](${tagsUrl})) or from `}a source checkout. The runtime is
dependency-free (only the Lean 4 prelude + Std; the HTTP transport shells out
to \`curl\`), so a plain Lake build is all that is needed:

\`\`\`bash
${cdTarget(target)}lake build
\`\`\`

Run the offline struct-corpus test (no server needed) and the live entity
tests (point them at a server with \`SDK_TEST_BASE\`):

\`\`\`bash
lake exe omnismoke
lake exe structcorpus
SDK_TEST_BASE=http://localhost:8901 lake exe runner
\`\`\`

`)
})

export { ReadmeInstall }
