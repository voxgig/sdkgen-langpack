// The vendored-tree guard: what makes `test/vendored.json` a drift check
// rather than a file nobody reads.
//
// `build/vendor.js --check` recomputes every route's content at the shared tag
// and compares it, byte for byte, against the manifest — but a check nothing
// RUNS guards nothing. sdkgen has `test/vendored.test.ts` for exactly this;
// the pack's runner was ported without its guard, so an edited or stale
// vendored file passed `npm test` clean.
//
// Two levels, because they fail differently and only one needs the network:
//
//   - The manifest and the tree must agree. Every destination the manifest
//     names must exist, hash to what it records, and carry the provenance
//     header the runner stamps. This is offline and always runs.
//   - `--check` itself must pass. It needs the upstream repository, so it is
//     SKIPPED with a stated reason when the clone is unavailable rather than
//     passing silently — a visible skip is this project's rule for a
//     capability the environment lacks.

const { test, describe } = require('node:test')
const { ok, deepStrictEqual, strictEqual } = require('node:assert')

const { spawnSync } = require('node:child_process')
const Crypto = require('node:crypto')
const Fs = require('node:fs')
const Path = require('node:path')

const ROOT = Path.resolve(__dirname, '..')
const SDK = Path.join(ROOT, '.sdk')
const MANIFEST = Path.join(ROOT, 'test', 'vendored.json')
const ROUTES = Path.join(ROOT, 'vendor', 'routes.json')


describe('vendored tree matches its manifest', () => {

  const manifest = JSON.parse(Fs.readFileSync(MANIFEST, 'utf8'))
  const routes = JSON.parse(Fs.readFileSync(ROUTES, 'utf8'))

  test('the manifest covers every route, and only routes', () => {
    const produced = routes.route.map((r) => r.lib + '/' + r.port).sort()
    deepStrictEqual(Object.keys(manifest.library).sort(), produced,
      'the manifest and routes.json disagree about which ports are vendored — ' +
      'run `node build/vendor.js`')
  })

  test('the manifest is at the tag routes.json declares', () => {
    strictEqual(manifest.tag, routes.tag,
      'the manifest was written at a different tag than routes.json names')
  })

  for (const [key, entry] of Object.entries(manifest.library)) {
    test(`${key}: every vendored file is present and unmodified`, () => {
      const bad = []
      for (const [dest, spec] of Object.entries(entry.file)) {
        const abs = Path.join(SDK, dest)
        if (!Fs.existsSync(abs)) {
          bad.push(dest + ': missing')
          continue
        }
        // LF-normalised, as the runner hashes it: git may check the tree out
        // with CRLF on Windows, and that is not drift.
        const disk = Fs.readFileSync(abs).toString('binary').replace(/\r\n/g, '\n')
        const sha = Crypto.createHash('sha256')
          .update(Buffer.from(disk, 'binary')).digest('hex')
        if (sha !== spec.sha256) bad.push(dest + ': content differs')
      }
      deepStrictEqual(bad, [],
        `${key}: a vendored file was edited or is stale. A local edit needs a ` +
        `marked PATCH block and an upstream issue — never a silent tweak; ` +
        `otherwise resync with \`node build/vendor.js\``)
    })

    test(`${key}: every vendored file carries its provenance header`, () => {
      const bad = []
      for (const dest of Object.keys(entry.file)) {
        const abs = Path.join(SDK, dest)
        if (!Fs.existsSync(abs)) continue
        const head = Fs.readFileSync(abs, 'utf8').split('\n').slice(0, 4).join('\n')
        if (!head.includes('VENDORED: @voxgig/')) bad.push(dest)
      }
      deepStrictEqual(bad, [],
        `${key}: a vendored file lost the header the runner stamps — it reads ` +
        `as ordinary pack source, which is how a vendored file gets hand-edited`)
    })
  }


  // The network half. Skipped visibly, never passed silently.
  test('`vendor.js --check` reports no drift', (t) => {
    const res = spawnSync('node', ['build/vendor.js', '--check'],
      { cwd: ROOT, encoding: 'utf8' })

    const out = (res.stdout || '') + (res.stderr || '')
    if (0 !== res.status && /clone|fatal|could not|network|resolve/i.test(out)) {
      return t.skip('upstream repository unavailable, so content cannot be ' +
        'recomputed at the tag: ' + out.trim().split('\n').slice(-1)[0])
    }

    strictEqual(res.status, 0, 'vendor --check reported drift:\n' + out)
    ok(/clean/.test(out), 'vendor --check did not report clean:\n' + out)
  })

})
