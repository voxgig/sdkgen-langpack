// The pack's tier guard: the `parity` claim in sdkgen-package.json, checked
// against what each target's suite ACTUALLY does.
//
// A tier is a claim a consumer relies on to know what is verified, and until
// this file existed nothing checked it anywhere: sdkgen's parity.test.ts reads
// sdkgen's own `tm/`, and a packaged target left that suite when it moved.
// `package check` validates the VOCABULARY (a tier outside
// FULL|MIRRORED|UNCOVERED|CONSUMER is an error) but not the CLAIM.
//
// The rules are sdkgen's, restated here because they are not exported — the
// corpus section list and the two detection patterns come from
// ts/test/parity.test.ts and must track it. That duplication is the cost of
// the pack being a separate repository; the alternative was no check at all.

const { test, describe } = require('node:test')
const { ok, deepStrictEqual } = require('node:assert')

const Fs = require('node:fs')
const Path = require('node:path')

const PARITY = require('../sdkgen-package.json').parity
const TARGETS = require('../sdkgen-package.json').provides.target
const TM = Path.resolve(__dirname, '..', '.sdk', 'tm')


// The 22 corpus sections every FULL-tier target must execute.
const CORPUS_SECTIONS = [
  'done', 'makeContext', 'makeError', 'makeOptions', 'makeRequest',
  'makeResponse', 'makeSpec', 'makeUrl', 'operator', 'param', 'prepareAuth',
  'prepareBody', 'prepareHeaders', 'prepareMethod', 'prepareParams',
  'preparePath', 'prepareQuery', 'resultBasic', 'resultBody', 'resultHeaders',
  'transformRequest', 'transformResponse',
]

// Does the suite LOAD the shared corpus, rather than only naming its sections?
const CORPUS_LOADERS =
  /test\.json|test_json|testJson|TEST_JSON|loadTestSpec|load_test_spec|LoadTestSpec|makeRunner|getSpec|resolveSpec/

// Tokens that look up a section IN the corpus. A section counts as driven
// only when its name appears on a line that also carries one — i.e. the name
// is being PASSED to the corpus lookup, not merely mentioned.
const SECTION_LOOKUP =
  /getSpec|get_spec|GetSpec|getspec|spec\.|spec\[|primary|runsection|runset|runSet|_runset|_g\(|_sec\(/


function corpusSources(lang) {
  const found = []
  const walk = (dir) => {
    if (!Fs.existsSync(dir)) return
    for (const e of Fs.readdirSync(dir, { withFileTypes: true })) {
      const p = Path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/primary/i.test(e.name) || /corpus/i.test(e.name)) found.push(p)
    }
  }
  walk(Path.join(TM, lang))
  return found.sort()
}


describe('parity tiers are true, not just declared', () => {

  test('every provided target declares a tier', () => {
    deepStrictEqual(TARGETS.filter((t) => null == PARITY[t]), [],
      'a target this pack provides has no `parity` entry — a consumer cannot ' +
      'tell what is verified, and an absent field reads the same as an author ' +
      'who did not know the field existed')
  })

  for (const lang of TARGETS) {
    const tier = PARITY[lang]

    if ('FULL' === tier) {
      test(`${lang}: FULL — drives every shared corpus section`, () => {
        const files = corpusSources(lang)
        ok(0 < files.length, `${lang}: no primary/corpus suite found under tm/${lang}`)

        const src = files.map((f) => Fs.readFileSync(f, 'utf8')).join('\n')
        ok(CORPUS_LOADERS.test(src),
          `${lang}: declares FULL but its suite never loads the shared corpus`)

        const lines = src.split('\n')
        const missing = CORPUS_SECTIONS.filter((section) =>
          !lines.some((l) => l.includes(section) && SECTION_LOOKUP.test(l)))

        deepStrictEqual(missing, [],
          `${lang}: declares FULL, but these sections are NAMED and never ` +
          `passed to the corpus lookup — the target runs its own hand-written ` +
          `cases for them, so nothing compares that behaviour against the ` +
          `reference. Either drive them, or declare MIRRORED and say so`)
      })
    }

    if ('MIRRORED' === tier) {
      test(`${lang}: MIRRORED — still has a primary-utility suite`, () => {
        ok(0 < corpusSources(lang).length,
          `${lang}: primary-utility suite disappeared — it was the only check ` +
          `on this target's request-shaping utilities`)
      })
    }

    if ('UNCOVERED' === tier) {
      test(`${lang}: UNCOVERED — genuinely uncovered, else promote it`, () => {
        deepStrictEqual(corpusSources(lang), [],
          `${lang}: gained a primary-utility suite — move it out of UNCOVERED ` +
          `(to FULL if it drives the corpus)`)
      })
    }
  }

})
