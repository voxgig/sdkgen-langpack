// Fake toolchains and suites: the selection of a toolchain per SDK root is the
// subject here, not lean itself.

const { test, describe, before, after } = require('node:test')
const { ok, strictEqual, deepStrictEqual, match, rejects } = require('node:assert')

const Fs = require('node:fs')
const Os = require('node:os')
const Path = require('node:path')

const { run, install, toolchain, compare, leanRelease } = require('./sdks')


// No lake reports this, so a suite run with it never passes.
const FAILS = 'no release'

let tmp
let toolchains
let decoy

before(() => {
  tmp = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'sdks-'))
  toolchains = Path.join(tmp, 'toolchains')
  for (const v of ['4.32.1', '4.33.0']) {
    fakeToolchain(Path.join(toolchains, leanRelease(v), 'bin'), v)
  }

  // On PATH ahead of everything: the lean a selection that ignored the pin
  // would run under.
  decoy = Path.join(tmp, 'decoy')
  fakeToolchain(decoy, '4.31.0')
  fakeExe(Path.join(decoy, 'dart'), 'Dart SDK version: 0.0.0 (fake)')
  fakeExe(Path.join(decoy, 'ghc'), 'fake ghc 0.0.0')
})

after(() => Fs.rmSync(tmp, { recursive: true, force: true }))


function fakeExe(file, line) {
  Fs.mkdirSync(Path.dirname(file), { recursive: true })
  Fs.writeFileSync(file, '#!/bin/sh\necho "' + line + '"\n', { mode: 0o755 })
}

// A lean and a lake that only say which release they are.
function fakeToolchain(bin, version) {
  fakeExe(Path.join(bin, 'lean'), 'Lean (version ' + version + ', fake)')
  fakeExe(Path.join(bin, 'lake'), 'lake ' + version)
}

// An SDK root whose suite prints the lake it ran under, then a tally that
// passes, or passes only under the lake of `passUnder`.
function fakeSdk(name, pin, passUnder) {
  const out = Path.join(tmp, name)
  for (const target of ['dart', 'haskell', 'lean']) {
    Fs.mkdirSync(Path.join(out, target), { recursive: true })
  }
  const lean = Path.join(out, 'lean')
  Fs.writeFileSync(Path.join(lean, 'lean-toolchain'), pin + '\n')
  Fs.writeFileSync(Path.join(lean, 'suite.sh'), 'lake --version\n' + (null == passUnder ?
    'echo "PASS 1  FAIL 0"\n' :
    'if [ "$(lake --version)" = "lake ' + passUnder + '" ]; then echo "PASS 1  FAIL 0"; ' +
    'else echo "PASS 0  FAIL 1"; fi\n'))
  Fs.writeFileSync(Path.join(lean, 'Makefile'), 'test:\n\t@sh suite.sh\n')
  return out
}

async function refuse() {
  throw new Error('no network')
}

function env(extra) {
  const e = {
    ...process.env,
    PATH: decoy + Path.delimiter + process.env.PATH,
    LEAN_TOOLCHAINS: toolchains,
    ...extra,
  }
  for (const k of Object.keys(e)) if (null == e[k]) delete e[k]
  return e
}


describe('sdks.js runs a lean SDK under the release it pins', () => {

  test('each SDK root selects the release its own lean-toolchain names', async () => {
    const a = fakeSdk('a', 'leanprover/lean4:v4.32.1')
    const b = fakeSdk('b', 'leanprover/lean4:v4.33.0')

    const ra = await run('lean', a, env())
    const rb = await run('lean', b, env())

    strictEqual(ra.bin, Path.join(toolchains, leanRelease('4.32.1'), 'bin'))
    strictEqual(rb.bin, Path.join(toolchains, leanRelease('4.33.0'), 'bin'))

    match(ra.output, /^lake 4\.32\.1$/m, 'a ran under another lake')
    match(rb.output, /^lake 4\.33\.0$/m, 'b ran under another lake')
    ok(!ra.output.includes('4.31.0') && !rb.output.includes('4.31.0'),
      'the lake on PATH ran, not the pinned one')

    match(ra.toolchain, /^Lean \(version 4\.32\.1, fake\) from .*, as lean-toolchain pins$/)
    match(rb.toolchain, /^Lean \(version 4\.33\.0, fake\) from .*, as lean-toolchain pins$/)
    deepStrictEqual(ra.tallies, [{ line: 'PASS 1  FAIL 0', pass: 1, fail: 0 }])
  })


  test('the lean on PATH serves when it is the pinned release', async () => {
    const a = fakeSdk('a-path', 'leanprover/lean4:v4.31.0')

    const r = await run('lean', a, env({ LEAN_TOOLCHAINS: null }))

    strictEqual(r.bin, null)
    match(r.output, /^lake 4\.31\.0$/m)
    match(r.toolchain, /^Lean \(version 4\.31\.0, fake\) from PATH, as lean-toolchain pins$/)
  })


  test('a lean that is not the pinned release is refused, naming both', async () => {
    const c = fakeSdk('c', 'leanprover/lean4:v4.34.0')

    await rejects(run('lean', c, env()),
      /pins leanprover\/lean4:v4\.34\.0 but the lean on PATH reports "Lean \(version 4\.31\.0, fake\)"/)

    const empty = Path.join(tmp, 'empty')
    Fs.mkdirSync(empty, { recursive: true })
    await rejects(run('lean', c, env({ LEAN_TOOLCHAINS: null, PATH: empty })),
      /lean: `lean` could not run from PATH/)
  })


  test('a release candidate pin is its own release', async () => {
    const rc = fakeSdk('rc', 'leanprover/lean4:v4.33.0-rc1')
    const final = fakeSdk('final', 'leanprover/lean4:v4.33.0')
    const rcFirst = (v) => env({
      PATH: Path.join(tmp, 'rc-' + v) + Path.delimiter + decoy + Path.delimiter + process.env.PATH,
      LEAN_TOOLCHAINS: null,
    })
    fakeToolchain(Path.join(tmp, 'rc-4.33.0-rc1'), '4.33.0-rc1')

    match((await run('lean', rc, rcFirst('4.33.0-rc1'))).toolchain, /^Lean \(version 4\.33\.0-rc1, fake\) from PATH/)
    await rejects(run('lean', final, rcFirst('4.33.0-rc1')), /pins leanprover\/lean4:v4\.33\.0 but the lean on PATH reports "Lean \(version 4\.33\.0-rc1, fake\)"/)
  })


  test('a lean-toolchain that names no release is refused', async () => {
    const d = fakeSdk('d', 'stable')

    await rejects(run('lean', d, env()), /unexpected toolchain "stable"/)
  })


  test('install fetches only a release that is absent', async () => {
    const fetched = []
    const download = async (version, release, dir) => {
      fetched.push([version, release, dir])
      fakeToolchain(Path.join(dir, release, 'bin'), version)
    }

    const a = fakeSdk('a-install', 'leanprover/lean4:v4.32.1')
    strictEqual(await install('lean', a, env(), download),
      Path.join(toolchains, leanRelease('4.32.1'), 'bin'))
    deepStrictEqual(fetched, [])

    const e = fakeSdk('e', 'leanprover/lean4:v4.35.0')
    strictEqual(await install('lean', e, env(), download),
      Path.join(toolchains, leanRelease('4.35.0'), 'bin'))
    deepStrictEqual(fetched, [['4.35.0', leanRelease('4.35.0'), toolchains]])

    const r = await run('lean', e, env())
    match(r.output, /^lake 4\.35\.0$/m)

    await rejects(install('lean', e, env({ LEAN_TOOLCHAINS: null }), download),
      /set LEAN_TOOLCHAINS/)
  })


  test('dart and haskell pin nothing, so install has nothing to fetch', async () => {
    const f = fakeSdk('f', 'leanprover/lean4:v4.32.1')

    strictEqual(await install('dart', f, env()), null)
    strictEqual(await install('haskell', f, env()), null)

    strictEqual((await toolchain('dart', f, env())).describe,
      'Dart SDK version: 0.0.0 (fake) from PATH')
    strictEqual((await toolchain('haskell', f, env())).describe,
      'fake ghc 0.0.0 from PATH')
  })


  test('the base branch SDK runs under its own pin, not the change\'s', async () => {
    const pr = Path.join(toolchains, leanRelease('4.33.0'), 'bin')
    const head = fakeSdk('head', 'leanprover/lean4:v4.33.0', FAILS)
    const base = fakeSdk('base', 'leanprover/lean4:v4.32.1', '4.32.1')
    const prFirst = env({ PATH: pr + Path.delimiter + decoy + Path.delimiter + process.env.PATH })

    await rejects(run('lean', head, prFirst), /a suite ran nothing or failed/)

    const v = await compare('lean', head, base, 'main', prFirst, refuse)

    strictEqual(v.level, 'error', v.message)
    match(v.message, /^the lean SDK passes on main under Lean \(version 4\.32\.1, fake\) from .*lean-4\.32\.1-[^ ]*, as lean-toolchain pins, so this change breaks it under Lean \(version 4\.33\.0, fake\) from .*lean-4\.33\.0-/)
  })


  test('a base branch SDK failing under its own pin fails as well, naming both', async () => {
    const head = fakeSdk('head-2', 'leanprover/lean4:v4.33.0', FAILS)
    const base = fakeSdk('base-2', 'leanprover/lean4:v4.32.1', FAILS)

    const v = await compare('lean', head, base, 'main', env(), refuse)

    strictEqual(v.level, 'warning', v.message)
    match(v.message, /^the lean SDK fails on main as well, under Lean \(version 4\.32\.1, fake\) from .*; this change ran under Lean \(version 4\.33\.0, fake\) from /)
  })


  test('the base branch pin is installed for its own run', async () => {
    const fetched = []
    const download = async (version, release, dir) => {
      fetched.push(version)
      fakeToolchain(Path.join(dir, release, 'bin'), version)
    }
    const head = fakeSdk('head-3', 'leanprover/lean4:v4.32.1', FAILS)
    const base = fakeSdk('base-3', 'leanprover/lean4:v4.36.0', '4.36.0')

    const v = await compare('lean', head, base, 'main', env(), download)

    deepStrictEqual(fetched, ['4.36.0'])
    strictEqual(v.level, 'error', v.message)
    match(v.message, /passes on main under Lean \(version 4\.36\.0, fake\)/)
    match(v.message, /breaks it under Lean \(version 4\.32\.1, fake\)/)
  })


  test('a base branch pin that does not install gives no verdict', async () => {
    const head = fakeSdk('head-4', 'leanprover/lean4:v4.32.1', FAILS)
    const base = fakeSdk('base-4', 'leanprover/lean4:v4.37.0', '4.37.0')

    const v = await compare('lean', head, base, 'main', env(), refuse)

    strictEqual(v.level, 'warning', v.message)
    match(v.message, /^no verdict: the toolchain the lean SDK on main pins did not install \(no network\); this change ran under Lean \(version 4\.32\.1, fake\)/)
  })


  test('an unknown target is refused', async () => {
    await rejects(run('ocaml', tmp, env()), /unknown target: ocaml/)
    await rejects(install('ocaml', tmp, env()), /unknown target: ocaml/)
    await rejects(toolchain('ocaml', tmp, env()), /unknown target: ocaml/)
  })
})
