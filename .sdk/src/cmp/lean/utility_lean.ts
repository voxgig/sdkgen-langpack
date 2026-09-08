import * as Path from 'node:path'

import {
  clone,
  walk,
} from '@voxgig/struct'

import {
  each,
  targetFeatures,
} from '@voxgig/sdkgen'


function projectPath(suffix?: string): string {
  return Path.normalize(Path.join(__dirname, '../../..', suffix ?? ''))
}


// A Lean 4 string literal. Lean strings are UTF-8, so non-ASCII passes through;
// only the structural characters need escaping. (Backticks are ordinary in Lean
// strings, so the config's `body`-style transform exprs embed verbatim.)
function leanString(s: string): string {
  let out = '"'
  for (const ch of String(s)) {
    if (ch === '"') out += '\\"'
    else if (ch === '\\') out += '\\\\'
    else if (ch === '\n') out += '\\n'
    else if (ch === '\t') out += '\\t'
    else if (ch === '\r') out += '\\r'
    else out += ch
  }
  return out + '"'
}


// Lean reserved words that cannot be bare identifiers.
const LEAN_RESERVED = new Set<string>([
  'do', 'let', 'fun', 'match', 'with', 'if', 'then', 'else', 'by', 'end',
  'namespace', 'section', 'open', 'import', 'def', 'partial', 'mutual',
  'structure', 'inductive', 'class', 'instance', 'where', 'deriving', 'return',
  'try', 'catch', 'for', 'in', 'while', 'have', 'show', 'from', 'set_option',
])


// A collision-free lower-camel Lean identifier for a model name.
function leanVarName(name: string): string {
  let s = String(name).replace(/[^a-zA-Z0-9_]/g, '_')
  if (s.length === 0) {
    s = 'x'
  }
  s = s.charAt(0).toLowerCase() + s.slice(1)
  if (!/^[a-z_]/.test(s)) {
    s = 'e_' + s
  }
  return LEAN_RESERVED.has(s) ? s + '_' : s
}


// The lowercase-hyphenated package name (used for the lake package + repo).
function pkgName(model: any): string {
  const org = (model.origin || 'voxgig-sdk').replace(/-sdk$/, '')
  return `${org}-${model.name}-sdk`.toLowerCase().replace(/[^a-z0-9-]/g, '-')
}


// Remove `$`-suffixed model annotation keys (so the embedded config is clean).
// Emission-time normalisation of a model subtree (L0).
//
// Always drops jostraca's iteration metadata (`$`-suffixed keys: index$,
// key$, val$). With `dropDefaults`, also drops keys whose value IS the
// default the runtime already assumes when the key is absent, which is pure
// payload — see CONFIG_DEFAULT.
//
// Rebuilds the tree rather than mutating during a walk. The previous
// implementation walked a clone calling `delete p[k]`, but walk() assigns its
// callback's result back over the child (`setprop(out, ckey, walk(...))`), so
// the delete was undone on the way out and the helper silently did nothing.
// Returning `undefined` from the callback does not fix it either: setprop
// stores undefined rather than removing the key, which then emits as a null.
//
// `dropDefaults` is opt-in and must be passed ONLY for the entity subtree.
// `active` means something different in feature config, where absent reads as
// INACTIVE (see feature_init) — dropping `active: true` there would silently
// disable the feature.
// jostraca's iteration metadata, injected by each()/names() while it walks the
// model. Listed explicitly rather than matched by trailing-dollar suffix: a
// trailing dollar is not exclusive to jostraca -- Seneca uses entity$ as real
// data -- so a blanket suffix match can silently drop a legitimate API field.
const MODEL_META = ['index$', 'key$', 'val$']

// Keys whose value IS the default the runtime already assumes when the key is
// absent, so emitting them is pure payload.
const CONFIG_DEFAULT: Record<string, any> = {
  active: true,
  req: false,
  reqd: false,
}

// Subtrees carrying user payload rather than schema. An active:true inside an
// OpenAPI example is DATA, not a default, so default-pruning stops at these
// keys and everything below them is passed through untouched.
const PAYLOAD_KEYS = ['default', 'example', 'examples']

function clean(o: any, dropDefaults?: boolean): any {
  const prune = (node: any, defaults: boolean): any => {
    if (Array.isArray(node)) {
      return node.map((n: any) => prune(n, defaults))
    }
    if (null != node && 'object' === typeof node) {
      const out: any = {}
      for (const k of Object.keys(node)) {
        if (MODEL_META.includes(k)) {
          continue
        }
        if (defaults && k in CONFIG_DEFAULT && CONFIG_DEFAULT[k] === node[k]) {
          continue
        }
        out[k] = prune(node[k], defaults && !PAYLOAD_KEYS.includes(k))
      }
      return out
    }
    return node
  }
  return prune(o, true === dropDefaults)
}



// THE SECRETS FEATURE'S SHAPE FOR THIS TARGET, read in one place.
//
// Package_lean (the lakefile) and Main_lean (the SdkFeatures/Makefile marker
// fills and the Copy excludes) both need the same three answers - is the
// feature in this SDK, which plugin definitions did the model select, and
// therefore does the build bind libcurl - and two readings of the model
// could disagree, which is how a lakefile links an object the Makefile never
// compiled. The reading goes through targetFeatures, the one applicability
// rule (helpers/applicability), so a target without `provides: sekreto`
// never sees the feature at all.
//
// `def.lean` keys are qualified definitions (`Sekreto.hashicorp`), and the
// import each needs is derived from the path's module tail
// (`.../SekretoPlugins/Hashicorp.lean` -> `SekretoPlugins.Hashicorp`), so a
// one-file-two-definitions entry (aws) yields one import line.
function leanSecrets(model: any, target: any): {
  active: boolean, imports: string[], defs: string[], ffi: boolean,
} {
  const feature = targetFeatures(model, target)
  const secrets = feature.secrets

  if (null == secrets) {
    return { active: false, imports: [], defs: [], ffi: false }
  }

  const imports = new Set<string>()
  const defs: string[] = []

  each(secrets.plugin, (plugin: any) => {
    // Filter on `active` HERE rather than trusting the feature object to
    // arrive filtered (see Config_ts.pluginImports): the wrong reading
    // emits an import for a module the plugin trim just deleted.
    if (false === plugin.active || null == plugin.active) return

    for (const [sym, one] of Object.entries(plugin.def?.lean || {})) {
      const mod = String(one)
        .replace(/^src\/feature\/secrets\/sekreto\/plugins\//, '')
        .replace(/\.lean$/, '')
        .replace(/\//g, '.')
      imports.add(mod)
      defs.push(sym)
    }
  })

  return {
    active: true,
    imports: Array.from(imports).sort(),
    defs: defs.sort(),
    // A plugin group is what reaches the two externs (curl, the clock);
    // the four built-in kinds reach neither, so the binding is gated on
    // the DEFINITIONS, not on the feature.
    ffi: 0 < defs.length,
  }
}


export {
  clean,
  leanSecrets,
  leanString,
  leanVarName,
  pkgName,
  projectPath,
}
