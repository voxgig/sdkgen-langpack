import * as Path from 'node:path'

import {
  clone,
  walk,
} from '@voxgig/struct'

import {
  canonKey,
  entityIdField,
  opRequestShape,
  requiredItems,
} from '@voxgig/sdkgen'


function projectPath(suffix?: string): string {
  return Path.normalize(Path.join(__dirname, '../../..', suffix ?? ''))
}


// Haskell reserved words that cannot be used as identifiers.
const HS_RESERVED = new Set<string>([
  'case', 'class', 'data', 'default', 'deriving', 'do', 'else', 'foreign',
  'if', 'import', 'in', 'infix', 'infixl', 'infixr', 'instance', 'let',
  'module', 'newtype', 'of', 'then', 'type', 'where', 'as', 'hiding',
  'qualified',
])


// A collision-free lower-camel Haskell identifier for a model name.
function hsVarName(name: string): string {
  let s = String(name).replace(/[^a-zA-Z0-9_]/g, '_')
  if (s.length === 0) {
    s = 'x'
  }
  // Identifiers must start with a lowercase letter.
  s = s.charAt(0).toLowerCase() + s.slice(1)
  if (!/^[a-z_]/.test(s)) {
    s = 'e_' + s
  }
  return HS_RESERVED.has(s) ? s + '_' : s
}


// A Haskell string literal (7-bit safe: non-printable / non-ASCII use the
// decimal numeric escape with a `\&` separator so digits never merge).
function hsString(s: string): string {
  let out = '"'
  for (const ch of String(s)) {
    const code = ch.codePointAt(0) as number
    if (ch === '"') out += '\\"'
    else if (ch === '\\') out += '\\\\'
    else if (ch === '\n') out += '\\n'
    else if (ch === '\t') out += '\\t'
    else if (ch === '\r') out += '\\r'
    else if (code >= 32 && code < 127) out += ch
    else out += '\\' + code + '\\&'
  }
  return out + '"'
}


function formatHsValue(val: any): string {
  if (val === null || val === undefined) {
    return 'CVNull'
  }
  if (typeof val === 'string') {
    return '(CVStr ' + hsString(val) + ')'
  }
  if (typeof val === 'number') {
    return '(CVNum (' + (Number.isFinite(val) ? String(val) : '0') + '))'
  }
  if (typeof val === 'boolean') {
    return '(CVBool ' + (val ? 'True' : 'False') + ')'
  }
  if (Array.isArray(val)) {
    const items = val.map((v) => formatHsValue(v)).join(', ')
    return '(CVList [' + items + '])'
  }
  if (typeof val === 'object') {
    const items = Object.keys(val)
      .map((k) => '(' + hsString(k) + ', ' + formatHsValue(val[k]) + ')')
      .join(', ')
    return '(CVMap [' + items + '])'
  }
  return 'CVNull'
}


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


// A type-correct Haskell `Value` literal for a field's canonical type.
function hsLit(type: any): string {
  const k = canonKey(type)
  if ('INTEGER' === k || 'NUMBER' === k) return 'VNum 1'
  if ('BOOLEAN' === k) return 'VBool True'
  if ('ARRAY' === k || 'OBJECT' === k) return 'VNoval'
  return 'VStr "example"'
}


const TEST_ID = 'test01'


// A test-mode example's call argument, and the do-block lines that bind
// `seed` to a mock seed holding the record that call reads: testSdk0 starts
// with an empty mock.
function hsTestCall(ent: any, op: string, indent: string): { argExpr: string, seedLines: string } {
  const idF = entityIdField(ent)
  const isId = (it: any) => it.name === idF || 'id' === it.name
  const idLit = 'VStr ' + hsString(TEST_ID)
  const lit = (it: any) => isId(it) ? idLit : hsLit(it.type)

  const data = 'create' === op || 'update' === op || 'patch' === op
  let items: any[] = []
  if ('load' === op || 'remove' === op) {
    items = opRequestShape(ent, op).items.filter((it: any) => !it.optional || it.name === idF)
  }
  else if ('list' === op) {
    items = requiredItems(ent, 'list')
  }
  else if (data) {
    const own = opRequestShape(ent, op).items.filter((it: any) => !isId(it))
    const required = own.filter((it: any) => !it.optional)
    items = required.length ? required : own.slice(0, 3)
  }
  items = [...items].sort((a: any, b: any) => (a.name === idF ? 0 : 1) - (b.name === idF ? 0 : 1))

  const jo = (entries: [string, string][]) =>
    'jo [' + entries.map(([name, value]) => '(' + hsString(name) + ', ' + value + ')').join(', ') + ']'
  const call: [string, string][] = items.map((it: any) => [it.name, lit(it)])

  const record = new Map<string, string>([['id', idLit]])
  if (null != idF) record.set(idF, idLit)
  if (!data) call.forEach(([name, value]) => record.set(name, value))

  const seedLines = [
    'seedRecord <- ' + jo([...record]),
    'seedRecords <- ' + jo([[TEST_ID, 'seedRecord']]),
    'seedEntities <- ' + jo([[ent.name, 'seedRecords']]),
    'seed <- ' + jo([['entity', 'seedEntities']]),
  ].map((line) => indent + line).join('\n')

  return { argExpr: 0 < call.length ? jo(call) : 'emptyMap', seedLines }
}


export {
  clean,
  formatHsValue,
  hsLit,
  hsString,
  hsTestCall,
  hsVarName,
  projectPath,
}
