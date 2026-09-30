
import {
  cmp,
  each,
  File,
  Content,
  entityCollection,
  isAuthSuppressed,
  isHttpBasicAuth,
  resolveAuthIn,
  resolveAuthName,
} from '@voxgig/sdkgen'

import { hsVarName } from './utility_haskell'


// The canary sweep (port of the ts TestClean component): canaries in every
// credential slot, every diagnostic feature capturing into a sink, a real
// operation through every outcome, and every emitted string searched for the
// canaries and their encoded forms. The client has no reflection, so the
// candidate operations are listed at generation time.
const TestClean = cmp(function TestClean(props: any) {
  const { model } = props.ctx$
  const { target } = props

  const auth = {
    suppressed: isAuthSuppressed(model),
    where: resolveAuthIn(model),
    name: 'header' === resolveAuthIn(model)
      ? resolveAuthName(model).toLowerCase() : resolveAuthName(model),
    basic: isHttpBasicAuth(model),
  }

  const rank: Record<string, number> = { list: 0, load: 1 }
  const candidates: string[] = []
  each(entityCollection(model))
    .filter((e: any) => false !== e.active)
    .forEach((ent: any) => {
      const fn = hsVarName(ent.name)
      const ops = Object.keys(ent.op || {})
        .filter((op) => ['list', 'load', 'create', 'update', 'remove'].includes(op))
        .sort((a, b) => (rank[a] ?? 2) - (rank[b] ?? 2))
      for (const op of ops) {
        const call = 'list' === op
          ? `es <- eList ent m ctrl; pure (vint (length es))`
          : `en <- e${op.charAt(0).toUpperCase() + op.slice(1)} ent m ctrl; eDataGet en`
        candidates.push(
          `  , Candidate "${ent.name}.${op}" (\\sdk ctrl -> do ent <- C.${fn} sdk VNoval; m <- emptyMap; ${call})`)
      }
    })

  File({ name: 'TClean.' + target.ext }, () => Content(render(auth, candidates)))
})


function render(
  auth: { suppressed: boolean, where: string, name: string, basic: boolean },
  candidates: string[],
): string {
  return `-- Generated secret-redaction sweep. Every credential slot holds a canary,
-- every diagnostic feature this SDK carries captures into a sink, a real
-- operation runs through every outcome, and every string that leaves the SDK
-- is searched for the canaries and their encoded forms. The second action
-- switches clean off and requires the canary to show, so a sweep that cannot
-- see a leak fails rather than passing.
{-# LANGUAGE ScopedTypeVariables #-}

module TClean (tests) where

import Control.Exception (SomeException, fromException, try)
import Control.Monad (forM, forM_, when)
import Data.IORef
import Data.List (intercalate, isInfixOf, isSuffixOf)
import Data.Maybe (isJust)

import VoxgigStruct (Value (..), emptyMap, listItems, ismap, stringify)
import SdkTypes
import SdkHelpers
import SdkRuntime (base64Encode, escurlS, contextToValue)
import qualified SdkClient as C
import Harness (hasFeature)
import Testutil

-- Generated: the credential's wire placement is fixed when the SDK is built.
-- The haskell runtime carries the credential in the Authorization header
-- whatever the model's placement says (its prepareAuth is header-only), so
-- that is the slot asserted. Placement: ${auth.where} (${auth.name}), basic: ${auth.basic}.
authSuppressed :: Bool
authSuppressed = ${auth.suppressed ? 'True' : 'False'}

canaryApikey, canarySecret, canaryHeader, canaryValue, mask :: String
canaryApikey = "CANARY-APIKEY-k9x2m7q4p1"
canarySecret = "CANARY-SECRET-w3e8r5t2y6"
canaryHeader = "CANARY-HEADER-z1x4c7v0b3"
canaryValue = "CANARY-VALUE-n5m8b2v9c4"
mask = "[redacted]"

-- Every form a canary can travel in.
forms :: IO [String]
forms = do
  encs <- forM [canaryApikey, canarySecret, canaryHeader, canaryValue] $ \\v -> do
    pe <- escurlS v
    pure [v, base64Encode v, pe]
  pure (concat encs ++ [base64Encode (canaryApikey ++ ":" ++ canarySecret)])

type Sinks = IORef [(String, String)]

push :: Sinks -> String -> String -> IO ()
push sinks name text = modifyIORef sinks (++ [(name, text)])

pushValue :: Sinks -> String -> Value -> IO ()
pushValue sinks name v = do
  j <- jsonifyCompact v
  push sinks (name ++ ":json") j
  s <- stringify v
  push sinks (name ++ ":string") s

-- Header maps keep the caller's spelling; the assertion should not care.
headerOf :: Value -> String -> IO String
headerOf m name = do
  v <- case m of VMap _ -> headerCI m name; _ -> pure VNoval
  pure (vstring v)

leaksIn :: [String] -> String -> [String]
leaksIn fs text = filter (\`isInfixOf\` text) fs

-- Transport-shaped response; \`json\` is the thunk the result stage calls.
response :: Int -> Value -> [(String, String)] -> IO Value
response status dat headers = do
  h <- jo (("content-type", VStr "application/json") : [(k, VStr v) | (k, v) <- headers])
  jo [ ("status", vint status), ("statusText", VStr (if status < 400 then "OK" else "ERR"))
     , ("headers", h), ("body", VStr "body"), ("json", jsonThunk dat) ]

data Scenario = Scenario { scName :: String, scRespond :: String -> IO Value }

scenarios :: [Scenario]
scenarios =
  [ Scenario "ok" (\\_ -> do
      d <- jo [("id", VStr "i1"), ("name", VStr "n1")]
      response 200 d [("x-session-token", "RESP-TOKEN-a1b2c3d4e5")])
  , Scenario "notfound" (\\_ -> do d <- jo [("error", VStr "no such record")]; response 404 d [])
  , Scenario "server" (\\_ -> do d <- jo [("error", VStr "boom")]; response 500 d [])
  -- The transport's failure is the map the system.fetch contract reserves
  -- for it, quoting the URL as a client library would.
  , Scenario "transport" (\\url -> jo [("__err__", VStr ("socket hang up (URL was: \\"" ++ url ++ "\\")"))])
  , Scenario "notjson" (\\_ -> do
      h <- emptyMap
      jo [ ("status", vint 200), ("statusText", VStr "OK"), ("headers", h)
         , ("body", VStr "<html>"), ("json", jsonThunk (VStr "<html>")) ])
  ]

makeSdk :: Scenario -> Sinks -> [(String, Value)] -> IO Client
makeSdk sc sinks cleanopts = do
  let capture name = vfunc1 (\\rec -> do pushValue sinks name rec; pure VNoval)
  feature <- emptyMap
  let addFeature fname extra = do
        present <- hasFeature fname
        when present $ do fo <- jo (("active", VBool True) : extra); setp feature fname fo
  addFeature "log" [("logger", capture "log")]
  addFeature "debug" [("onEntry", capture "debug")]
  addFeature "audit" [("sink", capture "audit")]
  addFeature "telemetry" [("exporter", capture "telemetry")]
  addFeature "metrics" []
  addFeature "clienttrack" []
  clean <- jo (("values", VStr canaryValue) : cleanopts)
  headers <- jo [("X-Custom-Token", VStr canaryHeader)]
  let fetch = vfunc1 (\\args -> do
        its <- listItems args
        scRespond sc (case its of (u : _) -> vstring u; [] -> ""))
  sys <- jo [("fetch", fetch)]
  opts <- jo [ ("apikey", VStr canaryApikey), ("secret", VStr canarySecret), ("headers", headers)
             , ("clean", clean), ("feature", feature), ("system", sys) ]
  sdk <- C.newSdk opts
  -- Captures the serialised context from inside the pipeline: what a hook
  -- author would hand to a logger.
  active <- newIORef True
  fopts <- newIORef VNoval
  let capHook name ctx = when (name \`elem\` ["PreRequest", "PreResponse", "PreUnexpected"]) $ do
        cv <- contextToValue ctx
        pushValue sinks ("ctx@" ++ name) cv
  modifyIORef (clFeatures sdk) (++ [Feature { fName = "capture", fVersion = "0.0.1", fActive = active
                                            , fOptions = fopts, fInit = \\_ _ -> pure (), fHook = capHook }])
  pure sdk

data Candidate = Candidate { cdName :: String, cdRun :: Client -> Value -> IO Value }

-- Every entity operation this SDK offers, list and load first.
candidates :: [Candidate]
candidates =
  [ Candidate "_.none" (\\_ _ -> ioError (userError "no candidate"))
${candidates.join('\n')}
  ]

-- The first operation that completes against a plain 200 with no arguments
-- (a required path parameter would fail before the request is built).
usableOp :: IO (Maybe Candidate)
usableOp = go (drop 1 candidates)
  where
    go [] = pure Nothing
    go (c : rest) = do
      d <- jo [("id", VStr "i1")]
      let fetch = vfunc1 (\\_ -> response 200 d [])
      sys <- jo [("fetch", fetch)]
      opts <- jo [("apikey", VStr canaryApikey), ("system", sys)]
      sdk <- C.newSdk opts
      ctrl <- emptyMap
      r <- try (cdRun c sdk ctrl) :: IO (Either SomeException Value)
      case r of
        Right _ -> pure (Just c)
        Left _ -> go rest

drive :: Client -> Candidate -> Value -> Sinks -> IO (Maybe Value)
drive sdk c ctrl sinks = do
  r <- try (cdRun c sdk ctrl) :: IO (Either SomeException Value)
  err <- case r of
    Right out -> do pushValue sinks "result" out; pure Nothing
    Left e -> case fromException e of
      Just (SdkException ev) -> do
        push sinks "error:show" (show (SdkException ev))
        pushValue sinks "error" ev
        pure (Just ev)
      Nothing -> do
        push sinks "error:show" (show e)
        em <- jo [("message", VStr (show e))]
        pure (Just em)
  ex <- getp ctrl "explain"
  case ex of VMap _ -> pushValue sinks "explain" ex; _ -> pure ()
  pure err

variants :: [(String, IO Value)]
variants =
  [ ("throw", emptyMap)
  , ("explain", do ex <- emptyMap; jo [("explain", ex)])
  , ("nothrow", do ex <- emptyMap; jo [("throw", VBool False), ("explain", ex)]) ]

tests :: Counters -> IO ()
tests c = do
  runAction c "clean.sweep" $ do
    mtarget <- usableOp
    case mtarget of
      Nothing -> do
        putStrLn "clean: no operation completes without arguments; nothing to sweep"
        check c "clean.usable_op" False
      Just target -> do
        sinks <- newIORef []
        errors <- newIORef ([] :: [(String, Value)])
        explains <- newIORef ([] :: [(String, Value)])
        forM_ scenarios $ \\sc -> forM_ variants $ \\(vname, mkCtrl) -> do
          sdk <- makeSdk sc sinks []
          ctrl <- mkCtrl
          merr <- drive sdk target ctrl sinks
          let key = scName sc ++ "/" ++ vname
          case merr of Just e -> modifyIORef errors (++ [(key, e)]); Nothing -> pure ()
          ex <- getp ctrl "explain"
          case ex of VMap _ -> modifyIORef explains (++ [(key, ex)]); _ -> pure ()
          -- The client record has no Show instance and no serialiser, so it
          -- has no default print to sweep.
        fs <- forms
        swept <- readIORef sinks
        let leaked = [(n, found) | (n, t) <- swept, let found = leaksIn fs t, not (null found)]
        putStrLn ("clean: swept " ++ show (length swept) ++ " surface(s), " ++ show (length leaked) ++ " leak(s)")
        forM_ leaked $ \\(n, found) -> putStrLn ("  leak: " ++ n ++ " [" ++ intercalate ", " found ++ "]")
        check c "clean.no_leak" (null leaked)

        -- The positive half: the slot the credential travelled in is masked,
        -- and an unregistered token in a response header is masked by name.
        errs <- readIORef errors
        exps <- readIORef explains
        check c "clean.404_throws" (isJust (lookup "notfound/throw" errs))
        notfound <- maybe emptyMap pure (lookup "notfound/throw" errs)
        nfResult <- getp notfound "result"
        st <- case nfResult of VMap _ -> getp nfResult "status"; _ -> pure VNoval
        check c "clean.404_status" (toInt st == 404)
        nfSpec <- getp notfound "spec"
        nfHeaders <- case nfSpec of VMap _ -> getp nfSpec "headers"; _ -> pure VNoval
        auth <- headerOf nfHeaders "authorization"
        check c "clean.credential_slot_masked" (authSuppressed || mask \`isSuffixOf\` auth)
        custom <- headerOf nfHeaders "x-custom-token"
        check c "clean.custom_header_masked" (custom == mask)
        explained <- maybe emptyMap pure (lookup "ok/explain" exps)
        exResult <- getp explained "result"
        check c "clean.explain_has_result" (ismap exResult)
        exHeaders <- case exResult of VMap _ -> getp exResult "headers"; _ -> pure VNoval
        session <- headerOf exHeaders "x-session-token"
        check c "clean.response_token_masked" (session == mask)

  runAction c "clean.sensitivity" $ do
    mtarget <- usableOp
    case mtarget of
      Nothing -> check c "clean.usable_op" False
      Just target -> do
        sinks <- newIORef []
        sdk <- makeSdk (scenarios !! 1) sinks [("active", VBool False)]
        ctrl <- emptyMap
        merr <- drive sdk target ctrl sinks
        fs <- forms
        swept <- readIORef sinks
        let leaked = [n | (n, t) <- swept, not (null (leaksIn fs t))]
        check c "clean.off_shows_canary" (not (null leaked))
        case merr of
          Nothing -> check c "clean.off_404_throws" False
          Just e -> do
            sp <- getp e "spec"
            text <- jsonifyCompact sp
            check c "clean.off_raw_spec_carries_credential"
              (authSuppressed || canaryApikey \`isInfixOf\` text ||
               base64Encode (canaryApikey ++ ":" ++ canarySecret) \`isInfixOf\` text)
`
}


export {
  TestClean
}
