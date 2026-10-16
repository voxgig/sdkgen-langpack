
import * as Path from 'node:path'


import {
  clone,
  walk,
} from '@voxgig/struct'

import {
  canonScalarKey,
  entityIdField,
  opRequestShape,
  requiredItems,
} from '@voxgig/sdkgen'


// Escape a string for a single-quoted Dart string literal. `$` must be
// escaped or Dart interpolates it (model values like '`$COPY`' would break).
function dartString(s: string): string {
  return "'" + String(s)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\$/g, '\\$')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t') + "'"
}


// Render a JSON-like value as a deep-dynamic Dart literal. Every map is
// emitted as `<String, dynamic>{...}` and every list as `<dynamic>[...]` so
// the runtime struct utilities can freely mutate/extend the structures
// (inferred literal types would be too narrow and throw at runtime).
function dartValue(obj: any, indent: number = 0): string {
  const pad = '  '.repeat(indent)
  const cpad = '  '.repeat(indent + 1)

  if (null == obj) {
    return 'null'
  }
  if ('string' === typeof obj) {
    return dartString(obj)
  }
  if ('number' === typeof obj) {
    return isFinite(obj) ? String(obj) : 'null'
  }
  if ('boolean' === typeof obj) {
    return obj ? 'true' : 'false'
  }
  if (Array.isArray(obj)) {
    if (0 === obj.length) {
      return '<dynamic>[]'
    }
    return '<dynamic>[\n' +
      obj.map(v => cpad + dartValue(v, indent + 1) + ',').join('\n') +
      '\n' + pad + ']'
  }
  if ('object' === typeof obj) {
    const keys = Object.keys(obj)
    if (0 === keys.length) {
      return '<String, dynamic>{}'
    }
    return '<String, dynamic>{\n' +
      keys.map(k => cpad + dartString(k) + ': ' + dartValue(obj[k], indent + 1) + ',')
        .join('\n') +
      '\n' + pad + '}'
  }
  return 'null'
}


function projectPath(suffix?: string): string {
  return Path.normalize(Path.join(__dirname, '../../..', suffix ?? ''))
}


const MODEL_META = ['index$', 'key$', 'val$']

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



function dartStringLiteral(json: string): string {
  return JSON.stringify(json).replace(/\$/g, '\\$')
}


// A type-correct Dart literal for a field's canonical type.
function dartLit(type: any): string {
  const k = canonScalarKey(type)
  if ('INTEGER' === k || 'NUMBER' === k) return '1'
  if ('BOOLEAN' === k) return 'true'
  if ('ARRAY' === k) return '<dynamic>[]'
  if ('OBJECT' === k) return '<String, dynamic>{}'
  return "'example'"
}


const TEST_ID = 'test01'


// A test-mode example's call argument, and the mock seed holding the record
// that call reads: SDK.test() starts with an empty mock.
function dartTestCall(ent: any, op: string, indent: string): { arg: string, seed: string } {
  const idF = entityIdField(ent)
  const isId = (it: any) => it.name === idF || 'id' === it.name
  const idLit = dartString(TEST_ID)
  const lit = (it: any) => isId(it) ? idLit : dartLit(it.type)

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

  const pairs = (entries: [string, string][]) =>
    entries.map(([name, value]) => dartString(name) + ': ' + value).join(', ')
  const call: [string, string][] = items.map((it: any) => [it.name, lit(it)])

  const record = new Map<string, string>([['id', idLit]])
  if (null != idF) record.set(idF, idLit)
  if (!data) call.forEach(([name, value]) => record.set(name, value))

  const pad = (n: number) => indent + '  '.repeat(n)
  const seed = '{\n' +
    pad(1) + "'entity': {\n" +
    pad(2) + dartString(ent.name) + ': {\n' +
    pad(3) + idLit + ': {' + pairs([...record]) + '},\n' +
    pad(2) + '},\n' +
    pad(1) + '},\n' +
    indent + '}'

  return { arg: 0 < call.length ? '{' + pairs(call) + '}' : '', seed }
}

export {
  dartStringLiteral,
  clean,
  dartLit,
  dartString,
  dartTestCall,
  dartValue,
  projectPath,
}
