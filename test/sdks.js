// Generates this pack's SDKs as a scaffolded project carries them, then builds
// one and runs its suite: `npm run sdks -- generate <out>`, then
// `npm run sdks -- run <dart|haskell|lean> <out>`. CREATE_SDKGEN names the
// @voxgig/create-sdkgen package root whose BuildSDK and corpus a project gets.

const Fs = require('node:fs')
const Path = require('node:path')
const { spawn } = require('node:child_process')
const { Readable } = require('node:stream')
const { pipeline } = require('node:stream/promises')

const { stageConsumer, generateInto } = require('@voxgig/sdkgen/testkit')
const { cmp, Project } = require('@voxgig/sdkgen')

const { PKG, TARGETS, compile, consumerModel } = require('./stage')


const SCAFFOLD = Path.join('project', 'standard', '.sdk')

const SUITES = {
  dart: {
    version: ['dart', '--version'],
    steps: [['dart', 'pub', 'get'], ['dart', 'analyze', 'lib'], ['dart', 'run', 'test/main.dart']],
  },
  haskell: { version: ['ghc', '--version'], steps: [['make', 'test']] },
  lean: { version: ['lean', '--version'], steps: [['make', 'test']] },
}

// A tally names a count of passes and of failures, as each suite prints them:
// dart `pass: 141  fail: 0`, haskell `TOTAL  PASS 1420  FAIL 0`, lean one
// `PASS n  FAIL m` per executable.
const TALLY = /\bpass:?[ \t]+(\d+)[ \t]+fail:?[ \t]+(\d+)/gi

const LEAN_PIN = /^leanprover\/lean4:v(\d+\.\d+\.\d+(?:-rc\d+)?)$/

// The suffix a lean release archive carries for this machine.
const LEAN_PLATFORM = {
  'linux-x64': 'linux', 'linux-arm64': 'linux_aarch64',
  'darwin-x64': 'darwin', 'darwin-arm64': 'darwin_aarch64',
}


async function generate(out) {
  const csg = createSdkgen()
  const consumer = stageConsumer({ recordLog: true })
  try {
    await consumer.addPackage(PKG)
    compile(consumer)

    const sdk = await generateInto(consumer, { model: consumerModel(consumer.sdk) })
    if (0 < sdk.leaks.length) {
      throw new Error('placeholders survived generation: ' + sdk.leaks.join(', '))
    }

    const data = await generateInto(consumer, {
      model: consumerModel(consumer.sdk),
      root: buildRoot(csg),
    })

    Fs.rmSync(out, { recursive: true, force: true })
    for (const [rel, content] of Object.entries({ ...sdk.files, ...data.files })) {
      Fs.mkdirSync(Path.dirname(Path.join(out, rel)), { recursive: true })
      Fs.writeFileSync(Path.join(out, rel), content)
    }
  }
  finally {
    consumer.cleanup()
  }

  Fs.copyFileSync(Path.join(csg, SCAFFOLD, 'test', 'test.json'),
    Path.join(out, '.sdk', 'test', 'test.json'))

  for (const target of TARGETS) {
    if (!Fs.existsSync(Path.join(out, target))) throw new Error(target + ': nothing generated')
  }
}


// create-sdkgen's own BuildSDK, rather than a copy that could drift from it.
function buildRoot(csg) {
  const sucrase = require('sucrase')
  const file = Path.join(csg, SCAFFOLD, 'src', 'BuildSDK.ts')
  const code = sucrase.transform(Fs.readFileSync(file, 'utf8'), {
    transforms: ['typescript', 'imports'], filePath: file,
  }).code

  const mod = { exports: {} }
  new Function('require', 'module', 'exports', code)(require, mod, mod.exports)
  const { BuildSDK } = mod.exports

  return cmp(function Root(props) {
    props.ctx$.model = props.model
    Project({}, () => BuildSDK({}))
  })
}


async function run(target, out, env = process.env) {
  const suite = SUITES[target]
  if (null == suite) throw new Error('unknown target: ' + target)

  const tc = await toolchain(target, out, env)
  console.log('\n' + target + ': under ' + tc.describe)

  let output = ''
  for (const [cmd, ...args] of suite.steps) {
    console.log('\n$ ' + [cmd, ...args].join(' '))
    const res = await exec(cmd, args, tc.cwd, tc.env)
    output += res.output
    if (0 !== res.code) throw new Error(target + ': `' + [cmd, ...args].join(' ') +
      '` exited with ' + res.code)
  }

  const tallies = output.split('\n').flatMap((line) => [...line.matchAll(TALLY)].map((m) => ({
    line: line.trim(), pass: Number(m[1]), fail: Number(m[2]),
  })))
  const bad = tallies.filter((t) => 0 === t.pass || 0 < t.fail)

  if (0 === tallies.length || 0 < bad.length) {
    throw new Error(target + ': ' + (0 === tallies.length ?
      'the suite printed no pass and fail counts, so nothing shows it ran' :
      'a suite ran nothing or failed: ' + bad.map((t) => t.line).join('; ')))
  }

  console.log('\n' + target + ': ' + tallies.map((t) => t.line).join('; ') +
    '\n' + target + ': under ' + tc.describe)

  return { toolchain: tc.describe, version: tc.version, bin: tc.bin, tallies, output }
}


// Only lean pins a toolchain, in the SDK root itself, so each root selects its
// own: a base branch's SDK may pin another release than the change's.
async function toolchain(target, out, env = process.env) {
  const suite = SUITES[target]
  if (null == suite) throw new Error('unknown target: ' + target)

  const cwd = Path.join(out, target)
  const pin = 'lean' === target ? leanPin(out) : null
  const bin = null == pin ? null : leanBin(pin.version, env)
  const childEnv = null == bin ? env :
    { ...env, PATH: bin + Path.delimiter + (env.PATH || '') }

  const [cmd, ...args] = suite.version
  const res = await exec(cmd, args, cwd, childEnv, false).catch((err) => {
    throw new Error(target + ': `' + cmd + '` could not run' +
      (null == bin ? ' from PATH' : ' from ' + bin) + ': ' + err.message)
  })
  if (0 !== res.code) {
    throw new Error(target + ': `' + suite.version.join(' ') + '` exited with ' + res.code)
  }
  const version = res.output.trim().split('\n')[0].trim()

  if (null != pin && !leanVersion(pin.version).test(version)) {
    throw new Error('lean: ' + Path.join(cwd, 'lean-toolchain') + ' pins ' + pin.pin +
      ' but the lean ' + (null == bin ? 'on PATH' : 'at ' + bin) + ' reports "' + version +
      '"; `sdks.js install lean ' + out + '` unpacks the pinned release under LEAN_TOOLCHAINS')
  }

  const describe = version + ' from ' + (null == bin ? 'PATH' : bin) +
    (null == pin ? '' : ', as lean-toolchain pins')

  return { cwd, env: childEnv, pin, bin, version, describe }
}


function leanPin(out) {
  const file = Path.join(out, 'lean', 'lean-toolchain')
  const pin = Fs.readFileSync(file, 'utf8').trim()
  const m = LEAN_PIN.exec(pin)
  if (null == m) {
    throw new Error('lean: unexpected toolchain ' + JSON.stringify(pin) + ' in ' + file)
  }
  return { pin, version: m[1] }
}


function leanVersion(version) {
  return new RegExp('\\bversion ' + version.replace(/\./g, '\\.') + '(?![\\w.-])')
}


// The directory a release archive unpacks to, which is how a version is found
// under LEAN_TOOLCHAINS.
function leanRelease(version) {
  const machine = process.platform + '-' + process.arch
  const platform = LEAN_PLATFORM[machine]
  if (null == platform) throw new Error('lean: no release is named for ' + machine)
  return 'lean-' + version + '-' + platform
}


// The unpacked pinned release, or null for PATH to serve.
function leanBin(version, env) {
  const dir = env.LEAN_TOOLCHAINS
  if (null == dir || '' === dir) return null
  const bin = Path.join(dir, leanRelease(version), 'bin')
  return Fs.existsSync(Path.join(bin, 'lake')) ? bin : null
}


// Unpacks the release the lean SDK at <out> pins under LEAN_TOOLCHAINS, when
// it is not there yet. The other targets have nothing to install.
async function install(target, out, env = process.env, download = downloadLean) {
  if (null == SUITES[target]) throw new Error('unknown target: ' + target)
  if ('lean' !== target) {
    console.log(target + ': nothing to install, the toolchain on PATH serves')
    return null
  }

  const dir = env.LEAN_TOOLCHAINS
  if (null == dir || '' === dir) {
    throw new Error('set LEAN_TOOLCHAINS to a directory to unpack lean releases into')
  }

  const pin = leanPin(out)
  const release = leanRelease(pin.version)
  let bin = leanBin(pin.version, env)
  if (null == bin) {
    await download(pin.version, release, dir)
    bin = leanBin(pin.version, env)
    if (null == bin) {
      throw new Error('lean: ' + release + ' did not unpack to ' + Path.join(dir, release, 'bin', 'lake'))
    }
  }

  console.log(pin.pin + ' at ' + bin)
  return bin
}


// Run after the <head> SDK fails its suite: whether the <base> branch's SDK,
// under the toolchain it pins, fails too.
async function compare(target, head, base, name, env = process.env, download = downloadLean) {
  const under = (out) => toolchain(target, out, env)
    .then((tc) => tc.describe, () => 'no toolchain it could run under')
  const headTc = await under(head)
  const sdk = 'the ' + target + ' SDK'

  try {
    await install(target, base, env, download)
  }
  catch (err) {
    return { level: 'warning', message: 'no verdict: the toolchain ' + sdk + ' on ' + name +
      ' pins did not install (' + err.message + '); this change ran under ' + headTc }
  }

  try {
    const res = await run(target, base, env)
    return { level: 'error', message: sdk + ' passes on ' + name + ' under ' + res.toolchain +
      ', so this change breaks it under ' + headTc }
  }
  catch (err) {
    console.error('\n' + err.message)
    return { level: 'warning', message: sdk + ' fails on ' + name + ' as well, under ' +
      await under(base) + '; this change ran under ' + headTc }
  }
}


async function downloadLean(version, release, dir) {
  const url = 'https://releases.lean-lang.org/lean4/v' + version + '/' + release + '.zip'
  console.log('lean: fetching ' + url + ' into ' + dir)
  Fs.mkdirSync(dir, { recursive: true })

  const zip = Path.join(dir, release + '.zip')
  const res = await fetch(url)
  if (!res.ok) throw new Error('lean: ' + url + ' answered ' + res.status)
  await pipeline(Readable.fromWeb(res.body), Fs.createWriteStream(zip))

  const unzip = await exec('unzip', ['-q', '-o', zip, '-d', dir], dir, process.env)
  if (0 !== unzip.code) throw new Error('lean: `unzip ' + zip + '` exited with ' + unzip.code)
  Fs.rmSync(zip)
}


function exec(cmd, args, cwd, env, relay = true) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    const collect = (stream) => (chunk) => {
      output += chunk
      if (relay) stream.write(chunk)
    }
    child.stdout.on('data', collect(process.stdout))
    child.stderr.on('data', collect(process.stderr))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, output }))
  })
}


function createSdkgen() {
  const dir = process.env.CREATE_SDKGEN
  if (null == dir || '' === dir) {
    throw new Error('set CREATE_SDKGEN to a @voxgig/create-sdkgen package root')
  }
  return Path.resolve(dir)
}


async function main([verb, ...args]) {
  const out = (i) => Path.resolve(args[i])
  if ('generate' === verb && 1 === args.length) return generate(out(0))
  if ('run' === verb && 2 === args.length) return run(args[0], out(1))
  if ('install' === verb && 2 === args.length) return install(args[0], out(1))
  if ('compare' === verb && 4 === args.length) {
    const { level, message } = await compare(args[0], out(1), out(2), args[3])
    return console.log('::' + level + '::' + message)
  }
  throw new Error('usage: sdks.js generate <out> | run <target> <out> | ' +
    'install <target> <out> | compare <target> <head-out> <base-out> <base-name>')
}


if (require.main === module) {
  main(process.argv.slice(2)).catch((err) => {
    console.error('\n' + (err?.message ?? err))
    process.exit(1)
  })
}


module.exports = { SUITES, TALLY, generate, run, install, toolchain, compare, leanPin, leanRelease }
