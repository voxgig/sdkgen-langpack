import {
  Content,
  File,
  Folder,
  cmp,
  each,
  entityCollection,
  isAuthSuppressed,
  isHttpBasicAuth,
  resolveAuthIn,
  resolveAuthName,
} from '@voxgig/sdkgen'

import {
  Model,
} from '@voxgig/apidef'


// True when an op has at least one endpoint point that needs no path params
// (a top-level operation the live smoke test can call without an id).
function hasParamFreePoint(op: any): boolean {
  if (null == op) return false
  const points = op.points || []
  for (const pt of points) {
    const params = ((pt.g || {}).params) || []
    if (params.length === 0) return true
  }
  return false
}


// True when an op selects a single record by path params — i.e. loading it by
// id is meaningful. A load whose every point is param-free is a singleton
// endpoint (`/current`): passing it an id matches no point at all, and the
// runtime raises `has no matching endpoint`.
function selectsByParams(op: any): boolean {
  if (null == op) return false
  const points = op.points || []
  for (const pt of points) {
    const params = ((pt.g || {}).params) || []
    if (0 < params.length) return true
  }
  return false
}


function synthData(fields: any): any {
  const o: any = {}
  each(fields, (f: any) => {
    if (f.r && f.n !== 'id') {
      const t = String(f.t || '').toLowerCase()
      o[f.n] =
        (t.includes('number') || t.includes('integer') || t.includes('decimal')) ? 42
          : t.includes('bool') ? true
            : 'leantest'
    }
  })
  return o
}


const Test = cmp(async function Test(props: any) {
  const ctx$ = props.ctx$
  const target = props.target
  const model: Model = ctx$.model

  const entity = each(entityCollection(model))
    .filter((e: any) => false !== e.active)

  let offline = ''
  each(entity, (e: any) => {
    const ns = e.name.charAt(0).toUpperCase() + e.name.slice(1)
    const Name = e.Name || (e.name.charAt(0).toUpperCase() + e.name.slice(1))
    const ops = e.op || {}
    if (!ops.list && !ops.load) return

    let body = ''

    if (ops.list) {
      body += `        -- list returns every seeded entity
        let items ← ${ns}.list tclient (← emptyMap) (← emptyMap)
        let n ← (match items with | Value.list lid => do pure (← listItems lid).size | _ => pure 0)
        if n == ids.size then pass s!"${e.name}.list offline -> {n} seeded"
        else fail s!"${e.name}.list offline: got {n}, want {ids.size}"
`
    }

    if (ops.load && selectsByParams(ops.load)) {
      body += `        -- load the first seeded entity by id
        if ids.size > 0 then do
          let wid := ids[0]!
          let m ← newMap #[("id", Value.str wid)]
          let got ← ${ns}.load tclient m (← emptyMap)
          let gid ← SdkRuntime.gpS got "id"
          if gid == wid then pass s!"${e.name}.load offline (id={wid})"
          else fail s!"${e.name}.load offline: got {gid}, want {wid}"
`
    }

    if (ops.create && ops.load && ops.remove) {
      body += `        -- create -> load back -> remove, all in the store
        let newmap ← SdkRuntime.gp (← SdkRuntime.gp seed "new") "${e.name}"
        let nks ← keysof newmap
        if nks.size > 0 then do
          let payload ← SdkRuntime.gp newmap nks[0]!
          let created ← ${ns}.create tclient payload (← emptyMap)
          let cid ← SdkRuntime.gpS created "id"
          if cid == "" then fail "${e.name}.create offline returned no id" else do
            let m2 ← newMap #[("id", Value.str cid)]
            let back ← ${ns}.load tclient m2 (← emptyMap)
            if (← SdkRuntime.gpS back "id") == cid then
              pass s!"${e.name}.create/load offline (id={cid})"
            else fail s!"${e.name}.create/load offline mismatch"
            let _ ← ${ns}.remove tclient m2 (← emptyMap)
            let gone ← ${ns}.load tclient m2 (← emptyMap)
            match gone with
            | Value.map _ => fail s!"${e.name}.remove offline: still present"
            | _ => pass s!"${e.name}.remove offline (id={cid})"
`
    }

    if ('' === body) return

    offline += `    -- ${e.name}: offline (test-mode) entity behaviour
    (do
      let seedPath := "../.sdk/test/entity/${e.name}/${Name}TestData.json"
      if !(← System.FilePath.pathExists seedPath) then
        IO.println s!"skip - ${e.name}: no seed at {seedPath}"
      else do
        let seed ← SdkJson.jsonRead (← IO.FS.readFile seedPath)
        let tclient ← Sdk.testSdk0 seed
        let existing ← SdkRuntime.gp (← SdkRuntime.gp seed "existing") "${e.name}"
        let ids ← keysof existing
${body})
`
  })

  let blocks = ''
  each(entity, (e: any) => {
    const ns = e.name.charAt(0).toUpperCase() + e.name.slice(1)
    const listOp = (e.op || {}).list
    const createOp = (e.op || {}).create
    const removeOp = (e.op || {}).remove

    if (hasParamFreePoint(listOp)) {
      blocks += `    -- ${e.name}: list smoke
    (do
      let items ← ${ns}.list client (← emptyMap) (← emptyMap)
      match items with
      | Value.list lid => pass s!"${e.name}.list -> {(← listItems lid).size} items"
      | _ => fail "${e.name}.list did not return a list")
`
    }

    const loadOp = (e.op || {}).load
    if (hasParamFreePoint(createOp) && loadOp && removeOp) {
      const data = JSON.stringify(synthData(e.fields))
      blocks += `    -- ${e.name}: create / load / remove round-trip
    (do
      let d ← SdkJson.jsonRead ${JSON.stringify(data)}
      let created ← ${ns}.create client d (← emptyMap)
      let nid ← SdkRuntime.gpS created "id"
      if nid == "" then fail "${e.name}.create returned no id" else do
        let m ← newMap #[("id", .str nid)]
        let back ← ${ns}.load client m (← emptyMap)
        let bid ← SdkRuntime.gpS back "id"
        if bid == nid then pass s!"${e.name}.create/load round-trip (id={nid})"
        else fail s!"${e.name}.load mismatch: {bid} != {nid}"
        let _ ← ${ns}.remove client m (← emptyMap)
        pass s!"${e.name}.remove (id={nid})")
`
    }
  })

  const liveBlocks = blocks.split('\n').map((l) => l ? '  ' + l : l).join('\n')

  // A `do` block whose last statement is a `let` is a type error in Lean
  // ("the rest of the do block has monadic result type"), and an entirely
  // empty one does not parse at all. An API whose entities offer no op these
  // lanes can drive leaves both empty, so terminate them explicitly.
  const offlineBody = '' === offline ? '    pure ()\n' : offline
  const liveBody = '' === blocks ? '      pure ()\n' : liveBlocks

  // The secret-redaction sweep's candidate operations: every entity op this
  // SDK offers, list and load first. Lean has no reflection, so they are
  // listed at generation time.
  const auth = {
    suppressed: isAuthSuppressed(model),
    where: resolveAuthIn(model),
    name: 'header' === resolveAuthIn(model)
      ? resolveAuthName(model).toLowerCase() : resolveAuthName(model),
    basic: isHttpBasicAuth(model),
  }
  const rank: Record<string, number> = { list: 0, load: 1 }
  const candidates: string[] = []
  each(entity, (e: any) => {
    const ns = e.name.charAt(0).toUpperCase() + e.name.slice(1)
    const ops = Object.keys(e.op || {})
      .filter((op) => ['list', 'load', 'create', 'update', 'remove'].includes(op))
      .sort((a, b) => (rank[a] ?? 2) - (rank[b] ?? 2))
    for (const op of ops) {
      const call = 'update' === op
        ? `${ns}.update c (← emptyMap) (← emptyMap) ctrl`
        : `${ns}.${op} c (← emptyMap) ctrl`
      candidates.push(`  { name := "${e.name}.${op}", run := fun c ctrl => do ${call} }`)
    }
  })
  const candidateBody = 0 === candidates.length ? '' : '\n' + candidates.join(',\n')

  Folder({ name: 'test' }, () => {
  File({ name: 'Runner.' + target.ext }, () => {
    Content(`-- ${model.const.Name} SDK test runner (generated by @voxgig/sdkgen).
--
-- OFFLINE lane (always): a test-mode client seeded from the generated entity
-- test data answers operations from an in-memory store — no server needed.
-- LIVE lane (only when SDK_TEST_BASE is set): the same flow over real HTTP.
-- CLEAN lane (always): the secret-redaction sweep over a scripted transport.

import VoxgigStruct
import SdkJson
import SdkUtility
import SdkFeature
import SdkRuntime
import SdkClient

open VoxgigStruct

initialize npass : IO.Ref Nat ← IO.mkRef 0
initialize nfail : IO.Ref Nat ← IO.mkRef 0

def pass (msg : String) : SIO Unit := do
  npass.modify (· + 1)
  IO.println s!"ok   - {msg}"

def fail (msg : String) : SIO Unit := do
  nfail.modify (· + 1)
  IO.println s!"FAIL - {msg}"

def check (cond : Bool) (msg : String) : SIO Unit := do
  if cond then pass msg else fail msg

-- ---------------------------------------------------------------------------
-- The secret-redaction sweep. Every credential slot holds a canary, every
-- diagnostic feature this SDK carries is switched on, a real operation runs
-- through every outcome, and every string that leaves the SDK is searched
-- for the canaries and their encoded forms. The second half switches clean
-- off and requires the canary to show, so a sweep that cannot see a leak
-- fails rather than passing.
-- ---------------------------------------------------------------------------

-- Generated: the credential's wire placement is fixed when the SDK is built.
-- The lean runtime carries the credential in the Authorization header
-- whatever the model's placement says (its prepareAuth is header-only), so
-- that is the slot asserted. Placement: ${auth.where} (${auth.name}), basic: ${auth.basic}.
def authSuppressed : Bool := ${auth.suppressed ? 'true' : 'false'}

def canaryApikey : String := "CANARY-APIKEY-k9x2m7q4p1"
def canarySecret : String := "CANARY-SECRET-w3e8r5t2y6"
def canaryHeader : String := "CANARY-HEADER-z1x4c7v0b3"
def canaryValue : String := "CANARY-VALUE-n5m8b2v9c4"
def mask : String := "[redacted]"

/-- Every form a canary can travel in. -/
def canaryForms : SIO (Array String) := do
  let mut out : Array String := #[]
  for v in #[canaryApikey, canarySecret, canaryHeader, canaryValue] do
    let pe ← match (← escurl (.str v)) with | .str s => pure s | _ => pure v
    out := out ++ #[v, SdkUtility.base64Encode v, pe]
  pure (out.push (SdkUtility.base64Encode (canaryApikey ++ ":" ++ canarySecret)))

def containsStr (text pat : String) : Bool := (text.splitOn pat).length > 1

def leaksIn (fs : Array String) (text : String) : Array String :=
  fs.filter (containsStr text)

initialize cleanSinks : IO.Ref (Array (String × String)) ← IO.mkRef #[]

def pushSink (name text : String) : SIO Unit := cleanSinks.modify (·.push (name, text))

def pushValue (name : String) (v : Value) : SIO Unit := do
  pushSink (name ++ ":json") (← jsonify v (← newMap #[("indent", .num 0.0)]))
  pushSink (name ++ ":string") (← stringify v)

/-- Header maps keep the caller's spelling; the assertion should not care. -/
def headerOf (m : Value) (name : String) : SIO String := do
  match m with
  | .map _ => pure (SdkUtility.vs (← SdkFeature.headerCI m name))
  | _ => pure ""

def numOf (v : Value) : Float := match v with | .num n => n | _ => -1.0

def responseOf (status : Float) (body : Value) (headers : Array (String × Value)) : SIO Value := do
  let h ← newMap (#[("content-type", Value.str "application/json")] ++ headers)
  newMap #[("status", .num status), ("statusText", .str (if status < 400.0 then "OK" else "ERR")),
           ("headers", h), ("body", body)]

structure Scenario where
  name : String
  respond : String → SIO Value

def scenarioOk : Scenario := { name := "ok", respond := fun _ => do
  responseOf 200.0 (← newMap #[("id", .str "i1"), ("name", .str "n1")])
    #[("x-session-token", .str "RESP-TOKEN-a1b2c3d4e5")] }
def scenarioNotfound : Scenario := { name := "notfound", respond := fun _ => do
  responseOf 404.0 (← newMap #[("error", .str "no such record")]) #[] }
def scenarioServer : Scenario := { name := "server", respond := fun _ => do
  responseOf 500.0 (← newMap #[("error", .str "boom")]) #[] }
-- A transport failure is thrown, quoting the URL as a client library would.
def scenarioTransport : Scenario := { name := "transport", respond := fun url =>
  throw (IO.userError s!"socket hang up (URL was: \\"{url}\\")") }
def scenarioNotjson : Scenario := { name := "notjson", respond := fun _ => do
  responseOf 200.0 (.str "<html>") #[] }

def scenarios : Array Scenario :=
  #[scenarioOk, scenarioNotfound, scenarioServer, scenarioTransport, scenarioNotjson]

/-- A live client over the scenario's transport, every diagnostic feature the
    config carries switched on, and a capture feature that serialises the
    context from inside the pipeline (what a hook author would log). -/
def makeCleanSdk (sc : Scenario) (cleanopts : Array (String × Value)) : SIO Value := do
  let feature ← emptyMap
  let config ← SdkJson.jsonRead SdkConfig.configJson
  let cfeat ← SdkRuntime.gp config "feature"
  for name in #["log", "debug", "audit", "telemetry", "cost", "metrics", "clienttrack"] do
    if SdkUtility.isMapV (← SdkRuntime.gp cfeat name) then
      SdkUtility.sp feature name (← newMap #[("active", .bool true)])
  let clean ← newMap (#[("values", Value.str canaryValue)] ++ cleanopts)
  let headers ← newMap #[("X-Custom-Token", .str canaryHeader)]
  let opts ← newMap #[("apikey", .str canaryApikey), ("secret", .str canarySecret),
                      ("headers", headers), ("clean", clean), ("feature", feature)]
  let client ← SdkRuntime.mkClientWith opts SdkConfig.configJson
    (fun _ url _ => do pure ((← sc.respond url), none))
  let capture : SdkFeature.Feature := { name := "capture", hook := fun stage ctx => do
    if stage == "PreRequest" || stage == "PreResponse" || stage == "PreUnexpected" then
      pushValue ("ctx@" ++ stage) (← SdkUtility.contextJson ctx) }
  let id ← SdkFeature.registerFeature capture
  match (← SdkRuntime.gp client "features") with
  | .list lid => setListItems lid ((← listItems lid).push (.num id.toFloat))
  | _ => SdkUtility.sp client "features" (← newList #[.num id.toFloat])
  SdkUtility.sp (← SdkUtility.gpMap client "featureopts") "capture" (← newMap #[("active", .bool true)])
  pure client

structure Candidate where
  name : String
  run : Value → Value → SIO Value

def candidates : Array Candidate := #[${candidateBody}
  ]

/-- The first operation that completes against a plain 200 with no arguments
    (a required path parameter would fail before the request is built). -/
def usableOp : SIO (Option Candidate) := do
  for c in candidates do
    let client ← SdkRuntime.mkClientWith (← newMap #[("apikey", .str canaryApikey)]) SdkConfig.configJson
      (fun _ _ _ => do pure ((← responseOf 200.0 (← newMap #[("id", .str "i1")]) #[]), none))
    let ok ← try (do let _ ← c.run client (← emptyMap); pure true) catch _ => pure false
    if ok then return some c
  pure none

def drive (client : Value) (c : Candidate) (ctrl : Value) : SIO Unit := do
  try
    let out ← c.run client ctrl
    pushValue "result" out
  catch e =>
    pushSink "error:message" (toString e)
  let e ← SdkRuntime.gp ctrl "err"
  if SdkUtility.isMapV e then pushValue "error" e
  let ex ← SdkRuntime.gp ctrl "explain"
  if SdkUtility.isMapV ex then pushValue "explain" ex
  -- Every feature's records sit in the client's track buckets.
  pushValue "track" (← SdkRuntime.gp client "track")

def variants : Array (String × SIO Value) := #[
  ("throw", emptyMap),
  ("explain", do newMap #[("explain", ← emptyMap)]),
  ("nothrow", do newMap #[("throw", .bool false), ("explain", ← emptyMap)]) ]

def cleanSweep : SIO Unit := do
  match (← usableOp) with
  | none => fail "clean: no operation completes without arguments; nothing to sweep"
  | some target =>
    cleanSinks.set #[]
    let mut errors : Array (String × Value) := #[]
    let mut explains : Array (String × Value) := #[]
    for sc in scenarios do
      for (vname, mk) in variants do
        let client ← makeCleanSdk sc #[]
        let ctrl ← mk
        drive client target ctrl
        let key := sc.name ++ "/" ++ vname
        let e ← SdkRuntime.gp ctrl "err"
        if SdkUtility.isMapV e then errors := errors.push (key, e)
        let ex ← SdkRuntime.gp ctrl "explain"
        if SdkUtility.isMapV ex then explains := explains.push (key, ex)
        -- The client is a struct value whose serialisation IS its options
        -- map (documented as the raw credential), so it is not a surface.
    let fs ← canaryForms
    let swept ← cleanSinks.get
    let leaked := swept.filter (fun (_, t) => (leaksIn fs t).size > 0)
    IO.println s!"clean: swept {swept.size} surface(s), {leaked.size} leak(s)"
    for (n, t) in leaked do
      IO.println s!"  leak: {n} [{", ".intercalate (leaksIn fs t).toList}]"
    check (leaked.size == 0) "clean: no credential leaves the SDK in any form"
    -- The positive half: the slot the credential travelled in is masked, and
    -- an unregistered token in a response header is masked by name.
    match errors.find? (·.1 == "notfound/throw") with
    | none => fail "clean: the 404 scenario must throw"
    | some (_, e) =>
      check (numOf (← SdkRuntime.gp e "status") == 404.0) "clean: the 404 error carries its status"
      let hdrs ← SdkRuntime.gp (← SdkRuntime.gp e "spec") "headers"
      let auth ← headerOf hdrs "authorization"
      check (authSuppressed || auth.endsWith mask) s!"clean: the credential slot is masked ({auth})"
      check ((← headerOf hdrs "x-custom-token") == mask) "clean: the custom token header is masked"
    match explains.find? (·.1 == "ok/explain") with
    | none => fail "clean: the explain variant must fill the record"
    | some (_, ex) =>
      let res ← SdkRuntime.gp ex "result"
      check (SdkUtility.isMapV res) "clean: the explain record carries the result"
      check ((← headerOf (← SdkRuntime.gp res "headers") "x-session-token") == mask)
        "clean: a response token is masked by name"

def cleanSensitivity : SIO Unit := do
  match (← usableOp) with
  | none => fail "clean: no operation completes without arguments; nothing to sweep"
  | some target =>
    cleanSinks.set #[]
    let client ← makeCleanSdk scenarioNotfound #[("active", .bool false)]
    let ctrl ← emptyMap
    drive client target ctrl
    let fs ← canaryForms
    let swept ← cleanSinks.get
    check ((swept.filter (fun (_, t) => (leaksIn fs t).size > 0)).size > 0)
      "clean: with clean off, the canary shows (the sweep can see a leak)"
    let e ← SdkRuntime.gp ctrl "err"
    let text ← jsonify (← SdkRuntime.gp e "spec") (← newMap #[("indent", .num 0.0)])
    check (authSuppressed || containsStr text canaryApikey ||
           containsStr text (SdkUtility.base64Encode (canaryApikey ++ ":" ++ canarySecret)))
      "clean: the raw spec carries the credential when clean is off"

def defaultBase : String := "http://localhost:8901"

def main : IO UInt32 := do
  let liveBase ← IO.getEnv "SDK_TEST_BASE"
  let ctx ← mkCtx
  let offline : SIO Unit := do
${offlineBody}  offline.run ctx
  let sweep : SIO Unit := do
    cleanSweep
    cleanSensitivity
  sweep.run ctx
  match liveBase with
  | none => IO.println "skip - live lane (set SDK_TEST_BASE to enable)"
  | some base => do
    let live : SIO Unit := do
      let opts ← newMap #[("base", .str base)]
      let client ← Sdk.newSdk opts
${liveBody}    live.run ctx
  let p ← npass.get
  let f ← nfail.get
  IO.println ""
  IO.println s!"PASS {p}  FAIL {f}"
  if f > 0 then return 1 else return 0
`)
  })
  })
})


export {
  Test
}
