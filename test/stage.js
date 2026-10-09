// Stages a consumer of this pack and compiles its model, for the suite and
// for `sdks.js`, which builds and runs what the same model generates.

const { strictEqual } = require('node:assert')

const Fs = require('node:fs')
const Path = require('node:path')
const { execFileSync } = require('node:child_process')

const { Aontu } = require('aontu')


const PKG = Path.resolve(__dirname, '..')

// Run the same npm build against the components installed in the consumer.
function compile(consumer) {
  const config = Path.join(consumer.root, 'tsconfig.json')
  const outdir = Path.join(consumer.sdk, 'dist', 'cmp')
  Fs.copyFileSync(Path.join(PKG, 'tsconfig.json'), config)
  execFileSync(process.execPath, [process.env.npm_execpath,
    'run', 'build', '--', '--project', config, '--outDir', outdir,
  ], { cwd: PKG, stdio: 'inherit' })
  Fs.cpSync(Path.join(consumer.sdk, 'src', 'cmp'), outdir, {
    recursive: true,
    filter: (path) => !path.endsWith('.ts') && Path.basename(path) !== 'fragment',
  })
}

// The targets this package provides, read from the manifest rather than
// restated. A target added to the pack without a line here would otherwise
// join with no coverage at all — the silently-absent shape.
const TARGETS = require('../sdkgen-package.json').provides.target


// The API every target is generated from. Small, but carrying the shapes that
// have historically broken generation: a required and an optional field, an
// entity with an id binding, more than one operation, a PATCH beside a PUT
// (apidef keeps it as a sixth operation, `patch`), and a flow (several
// targets' test emitters read one and throw without it).
const API = `
main: kit: info: { title: 'Demo', version: '1.0.0', auth: false }
main: kit: config: headers: { 'content-type': 'application/json' }

main: kit: entity: planet: {
  alias: field: {}
  name: "planet"
  id: { field: "id", name: "id" }
  field: {
    id:     { name: "id",     kind: "field", type: "\`$STRING\`", required: true }
    title:  { name: "title",  kind: "field", type: "\`$STRING\`", required: true }
    radius: { name: "radius", kind: "field", type: "\`$NUMBER\`" }
  }
  fields: {
    "id": { h: 'Id', n: "id",     r: true,  t: "\`$STRING\`" }
    "radius": { h: 'Radius', n: "radius", r: false, t: "\`$NUMBER\`" }
    "title": { h: 'Title', n: "title",  r: true,  t: "\`$STRING\`" }
  }
  op: {
    list: {
      name: "list"
      points: [ {
        g: {}, m: "GET", o: "/planet", s: [{ lit: "planet" }]
        t: { req: "\`reqdata\`", res: "\`body\`" }
      } ]
    }
    load: {
      name: "load"
      points: [ {
        g: { params: [
          { k: "param", n: "id", or: "id", r: true, t: "\`$STRING\`", ex: "p01" }
        ] }
        m: "GET", o: "/planet/{id}", s: [{ lit: "planet" }, { var: "id" }]
        t: { req: "\`reqdata\`", res: "\`body\`" }
      } ]
    }
    create: {
      name: "create"
      points: [ {
        g: {}, m: "POST", o: "/planet", s: [{ lit: "planet" }]
        t: { req: "\`reqdata\`", res: "\`body\`" }
      } ]
    }
    update: {
      name: "update"
      points: [ {
        g: { params: [
          { k: "param", n: "id", or: "id", r: true, t: "\`$STRING\`", ex: "p01" }
        ] }
        m: "PUT", o: "/planet/{id}", s: [{ lit: "planet" }, { var: "id" }]
        t: { req: "\`reqdata\`", res: "\`body\`" }
      } ]
    }
    patch: {
      name: "patch"
      points: [ {
        g: { params: [
          { k: "param", n: "id", or: "id", r: true, t: "\`$STRING\`", ex: "p01" }
        ] }
        m: "PATCH", o: "/planet/{id}", s: [{ lit: "planet" }, { var: "id" }]
        t: { req: "\`reqdata\`", res: "\`body\`" }
      } ]
    }
  }
}

main: kit: flow: BasicPlanetFlow: {
  entity: "planet", kind: "basic", name: "BasicPlanetFlow"
  step: [
    { o: "list" }
    { o: "load", i: {
        ref: "planet_ref01", srcdatavar: "planet_ref01_data", suffix: "_dt0" } }
  ]
}
`


// A child entity, whose routes name its parent: a load, list or remove of it
// that gives only its own id leaves {planet_id} unfilled, which makeUrl
// refuses. Separate from API, so the documentation tests keep planet as the
// entity each page leads with.
const CHILD = `
main: kit: entity: moon: {
  alias: field: {}
  name: "moon"
  id: { field: "id", name: "id" }
  relations: ancestors: [[path($.main.kit.entity.planet)]]
  field: {
    id:        { name: "id",        kind: "field", type: "\`$STRING\`", required: true }
    planet_id: { name: "planet_id", kind: "field", type: "\`$STRING\`", required: true }
    title:     { name: "title",     kind: "field", type: "\`$STRING\`" }
  }
  fields: {
    "id": { h: 'Id', n: "id", r: true, t: "\`$STRING\`" }
    "planet_id": { h: 'PlanetId', n: "planet_id", r: true, t: "\`$STRING\`" }
    "title": { h: 'Title', n: "title", r: false, t: "\`$STRING\`" }
  }
  op: {
    list: {
      name: "list"
      points: [ {
        g: { params: [
          { k: "param", n: "planet_id", or: "planet_id", r: true, t: "\`$STRING\`" }
        ] }
        m: "GET", o: "/planet/{planet_id}/moon"
        s: [{ lit: "planet" }, { var: "planet_id" }, { lit: "moon" }]
        t: { req: "\`reqdata\`", res: "\`body\`" }
      } ]
    }
    load: {
      name: "load"
      points: [ {
        g: { params: [
          { k: "param", n: "id", or: "id", r: true, t: "\`$STRING\`" }
          { k: "param", n: "planet_id", or: "planet_id", r: true, t: "\`$STRING\`" }
        ] }
        m: "GET", o: "/planet/{planet_id}/moon/{id}"
        s: [{ lit: "planet" }, { var: "planet_id" }, { lit: "moon" }, { var: "id" }]
        t: { req: "\`reqdata\`", res: "\`body\`" }
      } ]
    }
    remove: {
      name: "remove"
      points: [ {
        g: { params: [
          { k: "param", n: "id", or: "id", r: true, t: "\`$STRING\`" }
          { k: "param", n: "planet_id", or: "planet_id", r: true, t: "\`$STRING\`" }
        ] }
        m: "DELETE", o: "/planet/{planet_id}/moon/{id}"
        s: [{ lit: "planet" }, { var: "planet_id" }, { lit: "moon" }, { var: "id" }]
        t: { req: "\`reqdata\`", res: "\`body\`" }
      } ]
    }
  }
}

main: kit: flow: BasicMoonFlow: {
  entity: "moon", kind: "basic", name: "BasicMoonFlow"
  step: [
    { o: "list", m: { planet_id: "planet01" } }
    { o: "load", m: { id: "moon01", planet_id: "planet01" }, i: {
        ref: "moon_ref01", srcdatavar: "moon_ref01_data", suffix: "_dt0" } }
    { o: "remove", m: { id: "moon01", planet_id: "planet01" }, i: {
        ref: "moon_ref01", srcdatavar: "moon_ref01_data", suffix: "_rm0" } }
  ]
}
`


function consumerModel(sdk, extra) {
  const src = [
    '@"@voxgig/apidef/model/apidef.aontu"',
    '@"@voxgig/sdkgen/model/sdkgen.aontu"',
    '@"target/target-index.aontu"',
    '@"feature/feature-index.aontu"',
    "name: 'demo'",
    API,
    extra || '',
  ].join('\n')

  const path = Path.join(sdk, 'model', 'generate-test.aontu')
  Fs.writeFileSync(path, src)

  const errs = []
  const model = new Aontu().generate(src, { path, errs })
  strictEqual(errs.length, 0,
    'model did not compile: ' + errs.map((e) => e.msg).join(' | '))

  return model
}


module.exports = { PKG, TARGETS, API, CHILD, compile, consumerModel }
