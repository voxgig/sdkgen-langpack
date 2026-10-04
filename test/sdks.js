// Generates this pack's SDKs as a scaffolded project carries them, then builds
// one and runs its suite: `npm run sdks -- generate <out>`, then
// `npm run sdks -- run <dart|haskell|lean> <out>`. CREATE_SDKGEN names the
// @voxgig/create-sdkgen package root whose BuildSDK and corpus a project gets.

const Fs = require('node:fs')
const Path = require('node:path')
const { spawn } = require('node:child_process')

const { stageConsumer, generateInto } = require('@voxgig/sdkgen/testkit')
const { cmp, Project } = require('@voxgig/sdkgen')

const { PKG, TARGETS, compile, consumerModel } = require('./stage')


const SCAFFOLD = Path.join('project', 'standard', '.sdk')

const SUITES = {
  dart: [['dart', 'pub', 'get'], ['dart', 'analyze', 'lib'], ['dart', 'run', 'test/main.dart']],
  haskell: [['make', 'test']],
  lean: [['make', 'test']],
}

// A tally names a count of passes and of failures, as each suite prints them:
// dart `pass: 141  fail: 0`, haskell `TOTAL  PASS 1420  FAIL 0`, lean one
// `PASS n  FAIL m` per executable.
const TALLY = /\bpass:?[ \t]+(\d+)[ \t]+fail:?[ \t]+(\d+)/gi


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


async function run(target, out) {
  const steps = SUITES[target]
  if (null == steps) throw new Error('unknown target: ' + target)

  const cwd = Path.join(out, target)
  let output = ''
  for (const [cmd, ...args] of steps) {
    console.log('\n$ ' + [cmd, ...args].join(' '))
    const res = await exec(cmd, args, cwd)
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

  console.log('\n' + target + ': ' + tallies.map((t) => t.line).join('; '))
}


function exec(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    const relay = (stream) => (chunk) => {
      output += chunk
      stream.write(chunk)
    }
    child.stdout.on('data', relay(process.stdout))
    child.stderr.on('data', relay(process.stderr))
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
  if ('generate' === verb && 1 === args.length) return generate(Path.resolve(args[0]))
  if ('run' === verb && 2 === args.length) return run(args[0], Path.resolve(args[1]))
  throw new Error('usage: sdks.js generate <out> | sdks.js run <target> <out>')
}


main(process.argv.slice(2)).catch((err) => {
  console.error('\n' + (err?.message ?? err))
  process.exit(1)
})
