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
| `haskell` | `MIRRORED` | has a primary-utility suite, but mirrors the corpus by hand rather than executing it, so cases can drift |
| `lean` | `FULL` | drives the shared corpus for every section |

**A caveat that belongs with those two FULL tiers.** The shared corpus is
materialised into each project as `.sdk/test/test.json`, so a real generated
SDK does execute it — the tier is accurate for a consumer. What this repository
cannot do is verify it: the corpus source lives in create-sdkgen and is not yet
published as a consumable package. Until it is, the suite here covers
generation, component type-checking and per-target behaviour, and the corpus
runs where the SDK is generated. Do not read a green build here as a green
corpus.

## Dart carries the secrets feature

`dart` declares `provides: { sekreto: true }` and ships a vendored
[sekreto](https://github.com/voxgig/sekreto) port under
`.sdk/tm/dart/lib/feature/secrets/` (34 files, each with a `VENDORED:`
provenance header naming the upstream tag). A project that turns the feature
on in its own model —

```
main: kit: feature: secrets: { active: true plugin: vault: active: true }
```

— gets `lib/Config.dart` importing exactly the plugin definitions its active
groups name, the inactive groups' files trimmed from the tree, the suite in
`test/feature/secrets/` registered in `test/main.dart`, and a `secrets()`
accessor on the SDK. A project without the feature, or with it `active:
false`, generates exactly as before.

**What that needs from sdkgen.** The feature MODEL is sdkgen's, not this
package's: `model/feature/secrets.aon` in `@voxgig/sdkgen` carries dart's
plugin `path` lists and `def: dart:` maps, and packs consume core feature
models rather than copying them. The published 4.9.0 predates those entries,
so against 4.9.0 dart's secrets feature emits no plugin definitions at all —
the suite's dart secrets test says so by name. It needs the first
`@voxgig/sdkgen` release cut from sdkgen `main` at or after `26658608`; when
that release exists, `engines.sdkgen` here should move to it.

**Lean carries it too.** `lean` declares `provides: { sekreto: true }` and
ships its own vendored sekreto and plugin ports under
`.sdk/tm/lean/src/feature/secrets/{sekreto,plugin}` (38 files, `VENDORED:`
headers, no import adaptation: each tree is a Lake `srcDir` root). The
static feature catalog `src/SdkFeatures.lean` gains the feature through
three marker slots that `Main_lean` fills only when the model activates it,
and `lakefile.toml` gains the `Plugin`, `Sekreto`, `SekretoPlugins` and
`SecretsFeature` libraries plus a `secrets` executable rooted at
`test/feature/secrets/TSecrets.lean`. A plugin GROUP (vault, aws, ...)
binds libcurl through two sdkgen-owned C stubs under
`src/feature/secrets/ffi/`, built by `make ffi` and linked through a
response file on the lakefile — so a plugin-bearing lean SDK is built and
run through make (`make build`, `make test`, `make exe EXE=secrets`), not
bare `lake exe`, which fails at link. Secrets on with no group, off, or
absent: no libcurl, and the target's zero-dependency promise holds. It has
the same sdkgen-release dependency as dart: the `def: lean:` maps are in
sdkgen's core `secrets.aon`, after 4.9.0.

**Vendoring.** The 34 dart and 38 lean files were carried over verbatim from
sdkgen, headers included. This repository has no vendor tool or manifest of
its own yet, so a resync from upstream is a manual copy until it grows one.

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

## Developing

```bash
npm install
npm test          # type-checks every target's components, then runs the suite
```

The suite runs on `@voxgig/sdkgen/testkit`: it installs this package into a
staged consumer through the real `package add`, compiles the components the way
a consumer's build does, and generates.

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
