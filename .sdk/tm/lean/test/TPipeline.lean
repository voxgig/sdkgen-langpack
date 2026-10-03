/- ProjectName SDK pipeline test: the request-shaping utilities driven
   directly. A header, cookie or query argument travels where the definition
   declares it (the ts pathquery.test.ts cases), the media headers follow the
   point, and a routed argument stays out of the body. -/

import VoxgigStruct
import SdkUtility

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

def gp := SdkUtility.gp
def gpS := SdkUtility.gpS
def isNov := SdkUtility.isNov

/-- A ctx whose options send the given default headers, with the given point,
    match and data. -/
def argCtx (headers point reqmatch reqdata : Array (String × Value)) : SIO Value := do
  let opts ← newMap #[("headers", ← newMap headers)]
  newMap #[("options", opts), ("point", ← newMap point),
           ("reqmatch", ← newMap reqmatch), ("reqdata", ← newMap reqdata)]

def argDef (p : String × String) : SIO Value :=
  newMap #[("name", .str p.1), ("orig", .str p.2)]

def defs (pairs : Array (String × String)) : SIO Value := do
  newList (← pairs.mapM argDef)

def cookieArgs : SIO Value := do
  newMap #[("header", ← defs #[("x_trace", "X-Trace")]),
           ("cookie", ← defs #[("session_id", "SESSIONID"), ("theme", "theme"), ("prefs", "prefs")])]

def queryArgs : SIO Value := do
  newMap #[("params", ← newList #[← newMap #[("name", .str "id")]]),
           ("query", ← defs #[("page_size", "pageSize"), ("lang", "lang"), ("trace", "trace")]),
           ("header", ← defs #[("x_trace", "X-Trace"), ("trace", "trace")]),
           ("cookie", ← defs #[("session_id", "SESSIONID"), ("lang", "lang")])]

/-- A header, cookie or query argument the entity declares as a field stays in
    the body, beside an unmarked one that leaves it. -/
def fieldArgCase : SIO Unit := do
  let tr ← newMap #[("req", .str "`reqdata`")]
  let mut kept := true
  for kind in #["header", "cookie", "query"] do
    let locale ← newMap #[("name", .str "locale"), ("orig", .str "Locale"), ("field", .bool true)]
    let args ← newMap #[(kind, ← newList #[locale, ← argDef ("session_id", "SESSIONID")])]
    let ctx ← argCtx #[] #[("args", args), ("transform", tr)] #[]
      #[("name", .str "n"), ("locale", .str "en"), ("session_id", .str "s1")]
    let b ← SdkUtility.transformRequest ctx
    kept := kept && (← keysof b) == #["locale", "name"] && (← gpS b "locale") == "en"
  check kept "transformRequest: an argument the entity declares as a field stays in the body"

def main : IO UInt32 := do
  let sctx ← mkCtx
  let go : SIO Unit := do
    (do
      let point ← newMap #[("method", .str "GET"), ("parts", ← newList #[.str "a"])]
      let attempt (allowop : Value) : SIO Value := do
        let op ← newMap #[("name", .str "load"), ("points", ← newList #[point])]
        let options ← newMap #[("allow", ← newMap #[("op", allowop)])]
        SdkUtility.makePoint (← newMap #[("op", op), ("options", options)])
      let refused ← attempt (.str "reload,unload")
      let named ← attempt (.str "list,\n LOAD")
      check ((← gpS refused "code") == "point_op_allow" && (← gpS named "method") == "GET")
        "makePoint: an allow list names whole operations, in any case"
      let numbered ← attempt (.num 5.0)
      let listed ← attempt (← newList #[.str "load"])
      check ((← gpS numbered "code") == "point_op_allow" && (← gpS listed "code") == "point_op_allow")
        "makePoint: an allow.op that is not a string allows nothing")

    (do
      let hdefs ← defs #[("idempotency_key", "Idempotency-Key"), ("page_size", "Page-Size")]
      let args ← newMap #[("header", hdefs)]
      let ctx ← argCtx #[("Idempotency-Key", .str "default"), ("user-agent", .str "sdk")]
        #[("args", args)] #[("idempotency_key", .str "k1")] #[("page_size", .str "3")]
      let h ← SdkUtility.prepareHeaders ctx
      check ((← gpS h "idempotency-key") == "k1" && isNov (← gp h "Idempotency-Key")
          && (← gpS h "page-size") == "3" && (← gpS h "user-agent") == "sdk")
        "prepareHeaders: a header argument replaces a default of the same name, in any case")

    (do
      let theme ← newList #[.str "dark", .str "x y"]
      let prefs ← newMap #[("lang", .str "en gb"), ("size", .str "2")]
      let ctx ← argCtx #[] #[("args", ← cookieArgs)] #[("session_id", .str "a b;c,d")]
        #[("theme", theme), ("prefs", prefs)]
      let h ← SdkUtility.prepareHeaders ctx
      check ((← gpS h "cookie") == "SESSIONID=a%20b%3Bc%2Cd; theme=dark; theme=x%20y; lang=en%20gb; size=2")
        "prepareHeaders: a cookie argument is form serialized and percent-encoded, one cookie per pair")

    (do
      let ctx ← argCtx #[("Cookie", .str "SESSIONID=old; session=a=b&theme=old ;lang=en"), ("user-agent", .str "sdk")]
        #[("args", ← cookieArgs)] #[("session_id", .str "s1")] #[("theme", .str "dark")]
      let h ← SdkUtility.prepareHeaders ctx
      check ((← gpS h "cookie") == "session=a=b&theme=old; lang=en; SESSIONID=s1; theme=dark"
          && isNov (← gp h "Cookie") && (← gpS h "user-agent") == "sdk")
        "prepareHeaders: a same-named cookie is replaced, every other kept whole")

    (do
      let prefs ← newMap #[("x y", .str "new")]
      let ctx ← argCtx #[("Cookie", .str "x%20y=old; theme=dark")] #[("args", ← cookieArgs)]
        #[("session_id", .str "s1")] #[("prefs", prefs)]
      let h ← SdkUtility.prepareHeaders ctx
      check ((← gpS h "cookie") == "theme=dark; SESSIONID=s1; x%20y=new")
        "prepareHeaders: a map cookie argument replaces a default under its encoded key")

    (do
      let ctx ← argCtx #[("Cookie", .str "lang=en")] #[("args", ← cookieArgs)]
        #[("session_id", .null)] #[]
      let h ← SdkUtility.prepareHeaders ctx
      check ((← gpS h "Cookie") == "lang=en" && isNov (← gp h "cookie"))
        "prepareHeaders: an absent or null cookie argument leaves the headers alone")

    (do
      let media ← newMap #[("kind", .str "json"), ("media", .str "application/vnd.api+json")]
      let ctx ← argCtx #[("content-type", .str "application/json")]
        #[("response", media), ("body", media)] #[] #[]
      let h ← SdkUtility.prepareHeaders ctx
      check ((← gpS h "accept") == "application/vnd.api+json"
          && (← gpS h "content-type") == "application/vnd.api+json")
        "prepareHeaders: the declared media is asked for and replaces the JSON default"
      let ctx2 ← argCtx #[("Accept", .str "text/plain"), ("content-type", .str "text/plain")]
        #[("response", media), ("body", media)] #[] #[]
      let h2 ← SdkUtility.prepareHeaders ctx2
      check ((← gpS h2 "Accept") == "text/plain" && isNov (← gp h2 "accept")
          && (← gpS h2 "content-type") == "text/plain")
        "prepareHeaders: a caller's accept and content-type win")

    (do
      let ctx ← argCtx #[] #[("params", ← newList #[.str "id"]), ("args", ← queryArgs)]
        #[("id", .str "i1"), ("x_trace", .str "t1"), ("session_id", .str "s1"), ("q", .str "x"),
          ("$action", .str "a"), ("page_size", .str "3"), ("lang", .str "en"), ("trace", .str "t1")] #[]
      let q ← SdkUtility.prepareQuery ctx
      check ((← keysof q) == #["lang", "pageSize", "q", "trace"] && (← gpS q "pageSize") == "3"
          && (← gpS q "lang") == "en" && (← gpS q "trace") == "t1" && (← gpS q "q") == "x")
        "prepareQuery: path, header and cookie arguments stay out, a query argument goes under its orig")

    (do
      let ctx ← argCtx #[] #[("args", ← queryArgs)] #[] #[("page_size", .str "3"), ("lang", .str "en")]
      let q ← SdkUtility.prepareQuery ctx
      check ((← keysof q) == #["lang", "pageSize"] && (← gpS q "pageSize") == "3")
        "prepareQuery: a query argument is taken from the data")

    (do
      let tr ← newMap #[("req", .str "`reqdata`")]
      let ctx ← argCtx #[] #[("args", ← queryArgs), ("transform", tr)] #[]
        #[("x_trace", .str "t1"), ("session_id", .str "s1"), ("page_size", .str "2"),
          ("title", .str "T"), ("$action", .str "a")]
      let b ← SdkUtility.transformRequest ctx
      check ((← keysof b) == #["title"] && (← gpS b "title") == "T")
        "transformRequest: a routed argument is left out of the body")

    fieldArgCase

    (do
      let body ← newMap #[("kind", .str "raw"), ("media", .str "text/plain")]
      let ctx ← argCtx #[] #[("body", body)] #[] #[("$body", .str "hello")]
      SdkUtility.sp ctx "opname" (.str "create")
      let b ← SdkUtility.prepareBody ctx
      check (b == .str "hello") "prepareBody: a raw request body is sent as given")

    (do
      let raw ← newMap #[("body", ← newMap #[("kind", .str "raw"), ("media", .str "text/plain")])]
      let json ← newMap #[("body", ← newMap #[("kind", .str "json"), ("media", .str "application/json")])]
      check ((← SdkUtility.bodyText raw (.str "hello")) == some "hello")
        "bodyText: a raw point's string body is sent as given"
      check ((← SdkUtility.bodyText json (.str "hello")) == some "\"hello\"")
        "bodyText: a JSON point's string body is sent as JSON"
      let node ← newMap #[("a", .str "b")]
      check ((← SdkUtility.bodyText json node) == some (← jsonify node)
          && (← SdkUtility.bodyText json .noval) == none)
        "bodyText: a node is JSON and no body is none")

  go.run sctx
  let p ← npass.get
  let f ← nfail.get
  IO.println ""
  IO.println s!"pipeline: PASS {p}  FAIL {f}"
  if f > 0 then return 1 else return 0
