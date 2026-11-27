-- VENDORED: @voxgig/plugin sdk-20261125-1959-0 (lean/src/Plugin/Export.lean)
-- Source: https://github.com/voxgig/plugin @ 8605cdc5e68a691130ae9b585baf8c0091a66351  [tag: sdk-20261125-1959-0]
-- License: MIT (c) voxgig - see repository LICENSE. Do not edit: resync from upstream.
import Plugin.Ref

/-!
# Exports (§11)

THE UNQUALIFIED ALIAS IS THE INTERESTING PART. `retry/client` resolves
to the UNTAGGED instance if one exists; if not, and exactly one tagged
instance exports that key, it resolves to that one; if two do, it is
`plugin_export_ambiguous` — deliberately diverging from seneca's silent
last-wins, because with multi-instance as a headline feature an
ambiguous alias is a defect waiting for production.
-/

namespace Plugin

/-- Answers `none` for "no such export", which is not an error —
`export/missing` pins that, and is why the answer is an `Option` rather
than a null Value. -/
def resolveExport (spec exported : Value) : PluginM (Option Value) := do
  let s := if spec.isStr then spec.asStr else ""
  let cs := s.toList
  if !cs.contains '/' then
    raise "plugin_export_ambiguous" ("export spec needs a key: " ++ s)
      (details1 "spec" (.str s))
  -- THE LAST `/`, not the first: a NAME may hold slashes (§4), a key may
  -- not. `takeWhile` stops at the first, so the split is taken on the
  -- REVERSED list and both halves are put back the right way round.
  let rcs := cs.reverse
  let head := String.mk ((rcs.dropWhile (· != '/')).drop 1).reverse
  let key := String.mk (rcs.takeWhile (· != '/')).reverse

  -- A fully qualified ref: exactly one answer or none.
  --
  -- VALIDATING, not tolerant. The canonical calls `canonRef head`,
  -- which RAISES — so `retry$bad!/client` is `plugin_bad_tag` and
  -- `2fa/client` is `plugin_bad_name`. Reading it with `tryRef` turned
  -- a configuration typo into an ordinary missing export, which is the
  -- error the caller most needs to see, silently swallowed.
  let want ← canonRefS head
  match (exported.items).find? (fun e =>
    (e.get "ref").asStr == want && (e.get "key").asStr == key) with
  | some e => return some (e.get "value")
  | none => pure ()

  -- An alias: the NAME, not a ref. Look at every instance of it.
  let byname := (exported.items).filter (fun e =>
    refName (e.get "ref").asStr == head && (e.get "key").asStr == key)
  if byname.isEmpty then return none

  -- The untagged instance wins outright when there is one.
  match byname.find? (fun e => !((e.get "ref").asStr.toList.contains '$')) with
  | some e => return some (e.get "value")
  | none =>
    if byname.length == 1 then
      return some ((byname.getD 0 .null).get "value")
    let refs := Value.sortWith Value.strLe (byname.map (fun e => (e.get "ref").asStr))
    let d := (Value.vmap.set "spec" (.str s)).set "refs" (.list (refs.map Value.str))
    raise "plugin_export_ambiguous"
      ("alias " ++ s ++ " matches " ++ toString byname.length ++ " instances: "
        ++ String.intercalate ", " refs) d

end Plugin
