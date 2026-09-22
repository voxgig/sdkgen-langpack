# @voxgig/sdkgen-langpack

Additional **language targets** for the
[Voxgig SDK Generator](https://github.com/voxgig/sdkgen): **Dart**, **Haskell**
and **Lean**.

```bash
npm install --save-dev @voxgig/sdkgen-langpack
voxgig-sdkgen package add @voxgig/sdkgen-langpack
npm run generate
```

That installs all three targets. To take just one:

```bash
voxgig-sdkgen target add @voxgig/sdkgen-langpack/dart
```

Generation is unchanged from there. These are ordinary language targets: they
produce a full SDK with the same entity model, the same operation pipeline and
the same feature set as any bundled target.

## Why a pack rather than three packages

Three languages that nobody releases separately do not need three release
trains. One package means one version, one test suite and one type-check lane,
and a consumer still installs exactly the targets they name.

The trade is real and worth stating: a fix to Dart bumps the version Haskell
and Lean ship under. If any of these languages later grows its own cadence and
its own maintainer, splitting it out is the same move that brought it here.

## Parity

Declared per target in `sdkgen-package.json`:

| target | tier | what that means |
|---|---|---|
| `dart` | `FULL` | drives the shared corpus for every section |
| `haskell` | `FULL` | drives the shared corpus for every section |
| `lean` | `FULL` | drives the shared corpus for every section |

`haskell` was `MIRRORED` until it gained an omni port: driving the shared
corpus needs the shared runner, and hand-written cases cannot fail when the
reference changes. Its first corpus run found two real defects — see
`.sdk/tm/haskell/test/TPrimaryCorpus.hs`.

A tier here is checked, not just declared: `test/parity.test.js` reads the
`parity` map and verifies each claim against what the target's suite actually
does.

**A caveat that belongs with those two FULL tiers.** The shared corpus is
materialised into each project as `.sdk/test/test.json`, so a real generated
SDK does execute it — the tier is accurate for a consumer. What this repository
cannot do is verify it: the corpus source lives in create-sdkgen and is not yet
published as a consumable package. Until it is, the suite here covers
generation, component type-checking and per-target behaviour, and the corpus
runs where the SDK is generated. Do not read a green build here as a green
corpus.

## Lean is deliberately different

Lean has no entity object. Its operations are namespaced free functions over
the client value (`Planet.load c m co`), dispatched by the config-driven
`SdkRuntime`, so there is no instance to return, no per-entity data or match
state, and no `.data()` hop. Every other target resolves an operation to an
entity instance.

That is a boundary, not a gap. Giving Lean the entity-returning contract means
designing an entity layer for the language, which is a decision in its own
right rather than a port of an existing one. The suite pins the current shape
so the difference stays deliberate.

The live transport is not different. `SdkRuntime.runOp` runs the same
pipeline as every other target, stage by stage through `SdkUtility`:
makeContext, makePoint, makeSpec (method, path, params, query, headers, the
body or the GraphQL envelope, then the credential), makeUrl, makeFetchDef,
the transport, makeResponse and the response transform, with the feature
hooks dispatched between them and `PreUnexpected` on the error exit. A hook
that has already done a stage's work says so on `ctx.out` — `point`, `spec`,
`request`, `response` or `result` — and that stage is then skipped, as the
matching reference utility skips it.

Constructing a client resolves the options through `makeOptions`, so what
the API model declares in `config.options` is in force from the first
operation: its `headers`, `prefix` and `suffix`, and `base` where the model
names none. `allow.op` is defaulted there too, and `makePoint` enforces it.

The transport is `curl -i`: every prepared header is sent, and the response
status, headers and body come back for the result and for the features that
read them (the cost feature's pricing header, for one). Reading that stream
means skipping what precedes the response — an interim `100 Continue`, and a
proxy's own `200 Connection Established` block, which curl prints for every
https request tunnelled through an HTTP proxy, `https_proxy` in the
environment included. `SdkRuntime.mkClientWith` builds a live client over a
caller-supplied transport, which is how `.sdk/tm/lean/test/TFeature.lean`
pins the wire without a server.

**What the shared corpus covers, and what it does not.** The corpus pins the
utility FUNCTIONS one at a time — `makeSpec`, `makeUrl`, `prepareMethod` and
the rest, each against its own fixture. It says nothing about how `runOp`
composes them, so a stage left out or called in the wrong order passes it.
That composition is pinned by the lean feature suite instead, over a
recording transport: the url, the method, the headers and the body that
reach the wire, the stages a failure dispatches, and each stage's
`ctx.out` short-circuit.

## dart and lean carry the secrets feature

Both declare `provides: { sekreto: true }` and ship a vendored
[sekreto](https://github.com/voxgig/sekreto) port — dart under
`.sdk/tm/dart/lib/feature/secrets/` (34 files), lean under
`.sdk/tm/lean/src/feature/secrets/{sekreto,plugin}` (38 files). Every file
keeps the `VENDORED:` provenance header naming its upstream tag. A project
that turns the feature on in its own model —

```
main: kit: feature: secrets: { active: true plugin: vault: active: true }
```

— gets exactly the plugin definitions its active groups name, the inactive
groups' files trimmed from the tree, the secrets suite registered, and a
`secrets()` accessor on the SDK. A project without the feature, or with it
`active: false`, generates exactly as before.

**The feature MODEL is sdkgen's, not this package's.**
`model/feature/secrets.aontu` in `@voxgig/sdkgen` carries the `path` lists and
the `def: dart:` and `def: lean:` maps; packs consume core feature models
rather than copying them. Those entries ship from 4.10.0 on;
`engines.sdkgen` here requires `>=4.23.0`, comfortably past that. Against an
sdkgen older than 4.10.0 the feature emits no plugin definitions at all, and
each target's secrets test says so by name.

**Lean builds through make.** A plugin GROUP (vault, aws, ...) binds libcurl
through two sdkgen-owned C stubs under `src/feature/secrets/ffi/`. Lake TOML
cannot compile C, so `make ffi` uses the system compiler and writes a link
response file that the lakefile reads — which means a plugin-bearing lean SDK
is built and run with `make build`, `make test`, `make exe EXE=secrets`, not
bare `lake exe`, which fails at link. Secrets on with no group, off, or
absent: no libcurl, and the target's zero-dependency promise holds.

**Vendoring is tag-pinned and guarded.** `vendor/routes.json` is this pack's
own route table — which upstream file, from which repository at the shared
tag, lands where, and how it is adapted on the way in. `make vendor` executes
it, stamping each file's `VENDORED:` provenance header and recording a sha256
in `test/vendored.json`; `make vendor-check` verifies without writing, and
`test/vendored.test.js` runs that same check under `npm test`, so an edited or
stale vendored file fails the suite. sdkgen's own route table records dart,
haskell and lean as excluded precisely because they need a route root here —
this is it. Resyncing is a tag bump in `routes.json` followed by `make
vendor`, not a hand copy.

## Developing

```bash
npm install
npm run build     # type-checks every target's components
npm test          # the comment and dependency gates, then the suite
```

The suite runs on `@voxgig/sdkgen/testkit`: it installs this package into a
staged consumer through the real `package add`, compiles the components the way
a consumer's build does, and generates.

All of that is Node and nothing else — no `dart`, no `lake`, no `ghc` is needed
or looked for, so the suite is green on a machine that could not build a single
generated SDK. Read a green build as what it is: components that type-check and
targets that generate. Whether you can compile the output is a question about
your own machine, and `command -v` is the way to ask it.

Validate the package itself with:

```bash
npx voxgig-sdkgen package check .
```

## Provenance

All three targets were generated from the same trees that shipped inside
`@voxgig/sdkgen`. Before each moved, its output was compared file by file
against the bundled version from the same model:

| target | files generated | differences |
|---|---|---|
| `dart` | 77 | 0 |
| `lean` | 26 | 0 |
| `haskell` | 29 | 0 |

Byte-identical, with no placeholder leaks on either side. Nothing about a
generated SDK changed in the move.
