// Direct unit tests for the operation-pipeline utilities. The generated
// entity tests exercise the happy path; these drive the error and edge
// branches (missing spec/response/result, 4xx handling, transport
// failures, feature ordering, auth header shaping) that a normal
// success-path op never reaches. All utilities are reached through
// `stdutil`, so this suite is API-agnostic. Port of ts test/pipeline.test.ts.

import 'harness.dart';

import '../lib/ProjectNameSDK.dart';
import '../lib/ProjectNameError.dart';
import '../lib/Operation.dart';
import '../lib/Response.dart';
import '../lib/Result.dart';
import '../lib/Spec.dart';
import '../lib/feature/base/BaseFeature.dart';
import '../lib/utility/ErrUtility.dart';
import '../lib/utility/Utility.dart';

// Transport-shaped response with a re-readable body + lowercased headers.
Map<String, dynamic> resp(int status, [dynamic data, Map<String, dynamic>? headers]) {
  final h = <String, dynamic>{};
  (headers ?? {}).forEach((k, v) => h[k.toLowerCase()] = v);
  return {
    'status': status,
    'statusText': status < 400 ? 'OK' : 'ERR',
    'body': 'body',
    'json': () => data,
    'headers': h,
  };
}

dynamic base([Map<String, dynamic>? over]) {
  final ctx = stdutil.makeContext({});
  ctx.utility = stdutil;
  ctx.ctrl = {};
  ctx.op = Operation({'name': 'load', 'entity': 'x'});
  over?.forEach((k, v) {
    switch (k) {
      case 'op':
        ctx.op = v is Operation || null == v ? v : Operation(v);
        break;
      case 'options':
        ctx.options = v;
        break;
      case 'spec':
        ctx.spec = v is Map ? Spec(v) : v;
        break;
      case 'response':
        ctx.response = v is Map ? Response(v) : v;
        break;
      case 'result':
        ctx.result = v is Map ? Result(v) : v;
        break;
      case 'out':
        ctx.out = Map<String, dynamic>.from(v);
        break;
      case 'ctrl':
        ctx.ctrl = v is Map ? Map<String, dynamic>.from(v) : v;
        break;
      case 'utility':
        ctx.utility = v;
        break;
      case 'entity':
        ctx.entity = v;
        break;
      case 'client':
        ctx.client = v;
        break;
    }
  });
  return ctx;
}

// A utility whose fetcher (or other member) is overridden (makeRequest tests).
Utility utilWith(dynamic fetcher) {
  final u = Utility();
  u.fetcher = fetcher;
  return u;
}

// Entity fake for the list-wrapping test.
class _FakeEnt {
  final List made;
  _FakeEnt(this.made);
  String get name => 'x';
  dynamic make() => _FakeEnt(made);
  dynamic data(dynamic d) {
    made.add(d);
  }
}

// Client fake exposing only options() (prepareAuth tests).
class _OptClient {
  final dynamic opts;
  _OptClient(this.opts);
  dynamic options() => opts;
}

// Client fake exposing only features (featureAdd tests).
class _FeatClient {
  List features = [];
}

BaseFeature _feat(String name, [Map<String, dynamic>? opts]) {
  final f = BaseFeature();
  f.name = name;
  if (null != opts) {
    f.options = opts;
  }
  return f;
}

const allow = {
  'op': 'load,list,create,update,remove',
  'method': 'GET,PUT,POST,PATCH,DELETE'
};

void tests() {
  describe('pipeline:makePoint + makeSpec', () {
    test('makePoint rejects a disallowed operation', (t) {
      final ctx = base({
        'op': {'name': 'nope', 'points': []},
        'options': {
          'allow': {'op': 'load'}
        }
      });
      equal('point_op_allow', errcode(stdutil.makePoint(ctx)));
    });

    test('makePoint rejects an operation with no endpoints', (t) {
      final ctx = base({
        'op': {'name': 'load', 'points': []},
        'options': {'allow': allow}
      });
      equal('point_no_points', errcode(stdutil.makePoint(ctx)));
    });

    test('makePoint returns the single point', (t) {
      final ctx = base({
        'op': {
          'name': 'load',
          'points': [
            {
              'method': 'GET',
              'parts': ['a']
            }
          ]
        },
        'options': {'allow': allow}
      });
      final r = stdutil.makePoint(ctx);
      equal(true, identical(r, ctx.op.points[0]));
    });

    test('makePoint short-circuits a feature-supplied point', (t) {
      final preset = {'method': 'GET'};
      final ctx = base({
        'out': {'point': preset}
      });
      equal(true, identical(preset, stdutil.makePoint(ctx)));
    });

    test('makeSpec short-circuits a feature-supplied spec', (t) {
      final preset = {'method': 'GET'};
      final ctx = base({
        'out': {'spec': preset}
      });
      equal(true, identical(preset, stdutil.makeSpec(ctx)));
    });
  });

  describe('pipeline:makeResponse', () {
    test('guards missing spec / response / result', (t) async {
      equal(
          'response_no_spec',
          errcode(await stdutil.makeResponse(
              base({'spec': null, 'response': {}, 'result': {}}))));
      equal(
          'response_no_response',
          errcode(await stdutil.makeResponse(
              base({'spec': {}, 'response': null, 'result': {}}))));
      equal(
          'response_no_result',
          errcode(await stdutil.makeResponse(
              base({'spec': {}, 'response': {}, 'result': null}))));
    });

    test('a 4xx response sets result.err and copies headers', (t) async {
      final ctx = base({
        'spec': {'step': 's'},
        'response': resp(404, null, {'x-a': '1'}),
        'result': {'ok': false}
      });
      await stdutil.makeResponse(ctx);
      ok(null != ctx.result.err);
      equal(404, ctx.result.status);
      equal('1', ctx.result.headers['x-a']);
    });

    test('a 2xx response parses the body and marks ok', (t) async {
      final ctx = base({
        'spec': {'step': 's'},
        'response': resp(200, {'v': 1}),
        'result': {'ok': false}
      });
      await stdutil.makeResponse(ctx);
      equal(true, ctx.result.ok);
      deepEqual(ctx.result.body, {'v': 1});
    });

    test('records to ctrl.explain when explain is on', (t) async {
      final ctx = base({
        'ctrl': {'explain': {}},
        'spec': {'step': 's'},
        'response': resp(200, {'v': 2}),
        'result': {'ok': false}
      });
      await stdutil.makeResponse(ctx);
      ok(null != ctx.ctrl['explain']['result']);
    });

    test('a body-parse exception is captured on result.err', (t) async {
      final throwing = resp(200, null);
      throwing['json'] = () => throw StateError('bad json');
      final ctx = base({
        'spec': {'step': 's'},
        'response': throwing,
        'result': {'ok': false}
      });
      await stdutil.makeResponse(ctx);
      ok(null != ctx.result.err);
    });

    test('short-circuits when a feature already supplied the response',
        (t) async {
      final preset = resp(299);
      final ctx = base({
        'out': {'response': preset},
        'spec': {},
        'response': {},
        'result': {}
      });
      equal(true, identical(preset, await stdutil.makeResponse(ctx)));
    });
  });

  describe('pipeline:makeResult', () {
    test('guards missing spec / result', (t) {
      equal('result_no_spec',
          errcode(stdutil.makeResult(base({'spec': null, 'result': {}}))));
      equal('result_no_result',
          errcode(stdutil.makeResult(base({'spec': {}, 'result': null}))));
    });

    test('list op wraps resdata into entity instances', (t) {
      final made = [];
      final ctx = base({
        'op': {'name': 'list', 'entity': 'x'},
        'entity': _FakeEnt(made),
        'spec': {'step': 's'},
        'result': {
          'resdata': [
            {'a': 1},
            {'a': 2}
          ]
        },
      });
      final r = stdutil.makeResult(ctx);
      equal(2, r.resdata.length);
      equal(2, made.length);
    });

    test('an empty list yields an empty resdata array', (t) {
      final ctx = base({
        'op': {'name': 'list', 'entity': 'x'},
        'entity': _FakeEnt([]),
        'spec': {'step': 's'},
        'result': {'resdata': []},
      });
      final r = stdutil.makeResult(ctx);
      deepEqual(r.resdata, []);
    });

    test('short-circuits on a preset result', (t) {
      final preset = {'ok': true};
      equal(
          true,
          identical(
              preset,
              stdutil.makeResult(base({
                'out': {'result': preset},
                'spec': {},
                'result': {}
              }))));
    });
  });

  describe('pipeline:makeRequest', () {
    test('guards a missing spec', (t) async {
      equal('request_no_spec',
          errcode(await stdutil.makeRequest(base({'spec': null}))));
    });

    test('a null transport result becomes a response error', (t) async {
      final ctx = base({
        'utility': utilWith((c, u, f) async => null),
        'spec': {'step': 's', 'method': 'GET', 'headers': {}}
      });
      final r = await stdutil.makeRequest(ctx);
      ok(null != r.err);
    });

    test('an Error transport result is carried on the response', (t) async {
      final boom = ProjectNameError('boom', 'boom', null);
      final ctx = base({
        'utility': utilWith((c, u, f) async => boom),
        'spec': {'step': 's', 'method': 'GET', 'headers': {}}
      });
      final r = await stdutil.makeRequest(ctx);
      equal(true, identical(boom, r.err));
    });

    test('a normal transport response is wrapped', (t) async {
      final ctx = base({
        'utility': utilWith((c, u, f) async => resp(200, {'a': 1})),
        'spec': {'step': 's', 'method': 'GET', 'headers': {}}
      });
      final r = await stdutil.makeRequest(ctx);
      equal(200, r.status);
    });

    test('records the fetchdef to ctrl.explain', (t) async {
      final ctx = base({
        'ctrl': {'explain': {}},
        'utility': utilWith((c, u, f) async => resp(200, {})),
        'spec': {'step': 's', 'method': 'GET', 'headers': {}},
      });
      await stdutil.makeRequest(ctx);
      ok(null != ctx.ctrl['explain']['fetchdef']);
    });

    test('a fetchdef error surfaces as a response error', (t) async {
      final u = Utility();
      u.makeFetchDef = (dynamic c) => ProjectNameError('fetchdef_boom', 'boom', null);
      final ctx = base({
        'utility': u,
        'spec': {'step': 's', 'method': 'GET', 'headers': {}}
      });
      final r = await stdutil.makeRequest(ctx);
      ok(null != r.err);
    });

    test('short-circuits a feature-supplied request', (t) async {
      final preset = resp(201);
      equal(
          true,
          identical(
              preset,
              await stdutil.makeRequest(base({
                'out': {'request': preset},
                'spec': {}
              }))));
    });
  });

  describe('pipeline:makeFetchDef', () {
    test('guards a missing spec', (t) {
      equal('fetchdef_no_spec',
          errcode(stdutil.makeFetchDef(base({'spec': null}))));
    });

    test('serialises an object body to JSON and inits a missing result', (t) {
      final ctx = base({
        'result': null,
        'spec': {
          'step': 's',
          'method': 'POST',
          'headers': {},
          'base': 'http://h',
          'prefix': '',
          'suffix': '',
          'parts': ['a'],
          'path': 'a',
          'body': {'x': 1}
        },
      });
      final fd = stdutil.makeFetchDef(ctx);
      ok(fd['body'] is String);
      ok(fd['url'].toString().contains('http://h'));
      ok(null != ctx.result); // result was lazily created
    });
  });

  describe('pipeline:makeError + done', () {
    test('done returns resdata on success', (t) {
      equal(
          42,
          stdutil.done(base({
            'result': {'ok': true, 'resdata': 42}
          })));
    });

    test('done throws the error when not ok', (t) {
      var threw = false;
      try {
        stdutil.done(base({
          'result': {'ok': false}
        }));
      } catch (_e) {
        threw = true;
      }
      equal(true, threw);
    });

    test('done cleans ctrl.explain on success', (t) {
      final ctx = base({
        'ctrl': {
          'explain': {
            'result': {'err': 'x'}
          }
        },
        'result': {'ok': true, 'resdata': 7}
      });
      equal(7, stdutil.done(ctx));
    });

    test('makeError returns resdata instead of throwing when ctrl.throw is false',
        (t) {
      final ctx = base({
        'ctrl': {'throw': false},
        'result': {'ok': false, 'resdata': 'fallback'}
      });
      equal('fallback', stdutil.makeError(ctx));
    });

    test('makeError records to ctrl.explain', (t) {
      final ctx = base({
        'ctrl': {'throw': false, 'explain': {}},
        'result': {'ok': false}
      });
      stdutil.makeError(ctx);
      ok(null != ctx.ctrl['explain']['err']);
    });
  });

  describe('pipeline:featureAdd ordering', () {
    _FeatClient client() =>
        _FeatClient()..features = [_feat('a'), _feat('b')];

    String names(_FeatClient c) =>
        c.features.map((f) => (f as dynamic).name).join(',');

    test('appends by default', (t) {
      final c = client();
      stdutil.featureAdd(base({'client': c}), _feat('z'));
      equal('a,b,z', names(c));
    });

    test('__before__ inserts ahead of the named feature', (t) {
      final c = client();
      stdutil.featureAdd(
          base({'client': c}), _feat('z', {'__before__': 'b'}));
      equal('a,z,b', names(c));
    });

    test('__after__ inserts behind the named feature', (t) {
      final c = client();
      stdutil.featureAdd(base({'client': c}), _feat('z', {'__after__': 'a'}));
      equal('a,z,b', names(c));
    });

    test('__replace__ swaps the named feature', (t) {
      final c = client();
      stdutil.featureAdd(
          base({'client': c}), _feat('z', {'__replace__': 'a'}));
      equal('z,b', names(c));
    });
  });

  describe('pipeline:feature order', () {
    dynamic resolve(dynamic feature) {
      final ctx = stdutil.makeContext({
        'utility': stdutil,
        'options': {'feature': feature},
        'config': {'options': {}},
      });
      return stdutil.makeOptions(ctx);
    }

    test('map form is ordered test-first (test is the base transport)', (t) {
      final o = resolve({
        'metrics': {'active': true},
        'test': {'active': true}
      });
      equal('test,metrics',
          (o['__derived__']['featureorder'] as List).join(','));
    });

    test('array form preserves the explicit developer-specified order', (t) {
      final o = resolve([
        {'name': 'metrics', 'active': true},
        {'name': 'test', 'active': true}
      ]);
      equal('metrics,test',
          (o['__derived__']['featureorder'] as List).join(','));
      // the List is normalized to a map for merge/init, opts preserved
      equal(true, o['feature']['metrics']['active']);
      equal(true, o['feature']['test']['active']);
    });

    test('map form with no test orders names deterministically', (t) {
      final o = resolve({
        'retry': {'active': true},
        'cache': {'active': true}
      });
      equal('cache,retry',
          (o['__derived__']['featureorder'] as List).join(','));
    });
  });

  describe('pipeline:prepareAuth', () {
    // Fake client so the exact options.auth / apikey shape is controlled.
    dynamic authCtx(dynamic options, dynamic headers) {
      return base({
        'client': _OptClient(options),
        'spec': null == headers ? null : {'headers': headers}
      });
    }

    test('guards a missing spec', (t) {
      equal(
          'auth_no_spec',
          errcode(stdutil.prepareAuth(authCtx({
            'auth': {'prefix': ''},
            'apikey': 'K'
          }, null))));
    });

    test('an apikey with a prefix is space-joined', (t) {
      final ctx = authCtx({
        'apikey': 'K',
        'auth': {'prefix': 'Bearer'}
      }, {});
      stdutil.prepareAuth(ctx);
      equal('Bearer K', ctx.spec.headers['authorization']);
    });

    test('a raw apikey (empty prefix) goes in as-is', (t) {
      final ctx = authCtx({
        'apikey': 'K',
        'auth': {'prefix': ''}
      }, {});
      stdutil.prepareAuth(ctx);
      equal('K', ctx.spec.headers['authorization']);
    });

    test('an empty apikey drops the header', (t) {
      final ctx = authCtx({
        'apikey': '',
        'auth': {'prefix': 'Bearer'}
      }, {
        'authorization': 'stale'
      });
      stdutil.prepareAuth(ctx);
      equal(null, ctx.spec.headers['authorization']);
    });

    test('a public API (no auth block) drops the header', (t) {
      final ctx = authCtx({'apikey': 'K'}, {'authorization': 'stale'});
      stdutil.prepareAuth(ctx);
      equal(null, ctx.spec.headers['authorization']);
    });

    test('a missing apikey option drops the header', (t) {
      final ctx = authCtx({
        'auth': {'prefix': 'Bearer'}
      }, {
        'authorization': 'stale'
      });
      stdutil.prepareAuth(ctx);
      equal(null, ctx.spec.headers['authorization']);
    });
  });

  describe('pipeline:result helpers', () {
    test('resultHeaders with a plain map copies entries', (t) {
      final ctx = base({
        'response': {'headers': {}},
        'result': {}
      });
      stdutil.resultHeaders(ctx);
      deepEqual(ctx.result.headers, {});
    });

    test('resultBody skips parsing when the body is absent', (t) async {
      final ctx = base({
        'response': {
          'json': () => {'a': 1},
          'body': null
        },
        'result': {}
      });
      await stdutil.resultBody(ctx);
      equal(null, ctx.result.body);
    });
  });

  // A header, cookie or query argument travels where the definition declares
  // it. Port of the ts pathquery.test.ts cases.
  describe('pipeline:prepareHeaders + prepareQuery + transformRequest', () {
    dynamic hctx(Map<String, dynamic> point, Map<String, dynamic> reqmatch,
        Map<String, dynamic> reqdata,
        [Map<String, dynamic>? headers]) {
      final ctx = stdutil.makeContext({
        'point': point,
        'reqmatch': reqmatch,
        'reqdata': reqdata,
      });
      ctx.utility = stdutil;
      ctx.client = _OptClient({'headers': headers ?? <String, dynamic>{}});
      return ctx;
    }

    final headerPoint = <String, dynamic>{
      'args': {
        'header': [
          {'name': 'idempotency_key', 'orig': 'Idempotency-Key', 'kind': 'header'},
          {'name': 'x_trace', 'orig': 'X-Trace', 'kind': 'header'},
          {'name': 'page_size', 'orig': 'Page-Size', 'kind': 'header'},
        ]
      }
    };

    test('a header argument from the match goes out under its orig', (t) {
      deepEqual({'user-agent': 'sdk', 'idempotency-key': 'k1', 'page-size': '3'},
          stdutil.prepareHeaders(hctx(headerPoint,
              {'idempotency_key': 'k1', 'page_size': 3}, {}, {'user-agent': 'sdk'})));
    });

    test('a header argument from the data goes out too', (t) {
      deepEqual({'x-trace': 't1'},
          stdutil.prepareHeaders(hctx(headerPoint, {}, {'x_trace': 't1', 'name': 'n'})));
    });

    test('an absent or null header argument is not sent', (t) {
      deepEqual({}, stdutil.prepareHeaders(hctx(headerPoint, {'idempotency_key': null}, {})));
    });

    test('a header argument replaces a default of the same name in any case', (t) {
      deepEqual({'user-agent': 'sdk', 'idempotency-key': 'call'},
          stdutil.prepareHeaders(hctx(headerPoint, {'idempotency_key': 'call'}, {},
              {'Idempotency-Key': 'default', 'user-agent': 'sdk'})));
    });

    final cookiePoint = <String, dynamic>{
      'args': {
        'header': [
          {'name': 'x_trace', 'orig': 'X-Trace', 'kind': 'header'}
        ],
        'cookie': [
          {'name': 'session_id', 'orig': 'SESSIONID', 'kind': 'cookie'},
          {'name': 'theme', 'orig': 'theme', 'kind': 'cookie'},
          {'name': 'prefs', 'orig': 'prefs', 'kind': 'cookie'},
        ],
      }
    };

    test('a cookie argument goes out in the cookie header as name=value', (t) {
      deepEqual({'cookie': 'SESSIONID=s1; theme=dark'},
          stdutil.prepareHeaders(hctx(cookiePoint, {'session_id': 's1'},
              {'theme': 'dark', 'name': 'n'})));
    });

    test('a cookie argument follows the cookies the caller sends, whatever the header case', (t) {
      deepEqual({'user-agent': 'sdk', 'cookie': 'lang=en; SESSIONID=s1'},
          stdutil.prepareHeaders(hctx(cookiePoint, {'session_id': 's1'}, {},
              {'Cookie': 'lang=en', 'user-agent': 'sdk'})));
    });

    test('an absent or null cookie argument leaves the headers alone', (t) {
      deepEqual({'Cookie': 'lang=en'},
          stdutil.prepareHeaders(hctx(cookiePoint, {'session_id': null}, {},
              {'Cookie': 'lang=en'})));
    });

    test('a cookie argument is form serialized and percent-encoded', (t) {
      deepEqual({'cookie': 'SESSIONID=a%20b%3Bc%2Cd; theme=dark; theme=x%20y; lang=en%20gb; size=2'},
          stdutil.prepareHeaders(hctx(cookiePoint, {'session_id': 'a b;c,d'},
              {'theme': ['dark', 'x y'], 'prefs': {'size': 2, 'lang': 'en gb'}})));
    });

    test('a cookie argument replaces a cookie of the same name the caller sends', (t) {
      deepEqual({'cookie': 'theme=dark; lang=en; SESSIONID=s1'},
          stdutil.prepareHeaders(hctx(cookiePoint, {'session_id': 's1'}, {},
              {'Cookie': 'SESSIONID=old; theme=dark ;lang=en'})));
    });

    test('a map cookie argument replaces the cookies its keys name, in their encoded form', (t) {
      deepEqual({'cookie': 'theme=dark; SESSIONID=s1; lang=en; size=2'},
          stdutil.prepareHeaders(hctx(cookiePoint, {'session_id': 's1'},
              {'prefs': {'lang': 'en', 'size': 2}}, {'Cookie': 'lang=old; theme=dark'})));
      deepEqual({'cookie': 'theme=dark; SESSIONID=s1; x%20y=new'},
          stdutil.prepareHeaders(hctx(cookiePoint, {'session_id': 's1'},
              {'prefs': {'x y': 'new'}}, {'Cookie': 'x%20y=old; theme=dark'})));
    });

    test('a default cookie whose value holds pairs is kept whole', (t) {
      deepEqual({'cookie': 'session=a=b&theme=old; SESSIONID=s1; theme=dark'},
          stdutil.prepareHeaders(hctx(cookiePoint, {'session_id': 's1'},
              {'theme': 'dark'}, {'Cookie': 'session=a=b&theme=old'})));
    });

    test('the declared response media is asked for, unless the caller set an accept', (t) {
      final media = <String, dynamic>{
        'response': {'kind': 'json', 'media': 'application/vnd.api+json'},
        'body': {'kind': 'json', 'media': 'application/vnd.api+json'},
      };
      deepEqual({'accept': 'application/vnd.api+json', 'content-type': 'application/vnd.api+json'},
          stdutil.prepareHeaders(hctx(media, {}, {}, {'content-type': 'application/json'})));
      deepEqual({'Accept': 'text/plain', 'content-type': 'text/plain'},
          stdutil.prepareHeaders(hctx(media, {}, {},
              {'Accept': 'text/plain', 'content-type': 'text/plain'})));
    });

    final queryPoint = <String, dynamic>{
      'params': ['id'],
      'transform': {'req': '`reqdata`'},
      'args': {
        'params': [
          {'name': 'id'}
        ],
        'query': [
          {'name': 'page_size', 'orig': 'pageSize', 'kind': 'query'},
          {'name': 'lang', 'orig': 'lang', 'kind': 'query'},
          {'name': 'trace', 'orig': 'trace', 'kind': 'query'},
        ],
        'header': [
          {'name': 'x_trace', 'orig': 'X-Trace', 'kind': 'header'},
          {'name': 'trace', 'orig': 'trace', 'kind': 'header'},
        ],
        'cookie': [
          {'name': 'session_id', 'orig': 'SESSIONID', 'kind': 'cookie'},
          {'name': 'lang', 'orig': 'lang', 'kind': 'cookie'},
        ],
      }
    };

    test('a path, header or cookie argument stays out of the query', (t) {
      deepEqual({'q': 'x'},
          stdutil.prepareQuery(hctx(queryPoint,
              {'id': 'i1', 'x_trace': 't1', 'session_id': 's1', 'q': 'x', r'$action': 'a'}, {})));
    });

    test('a query argument goes out under its orig, from the match or the data', (t) {
      deepEqual({'pageSize': 3, 'lang': 'en'},
          stdutil.prepareQuery(hctx(queryPoint, {'page_size': 3}, {'lang': 'en'})));
    });

    test('a query argument that shares a header or cookie name still goes out', (t) {
      deepEqual({'lang': 'en', 'trace': 't1'},
          stdutil.prepareQuery(hctx(queryPoint, {'lang': 'en', 'trace': 't1'}, {})));
    });

    test('a routed argument is left out of the body', (t) {
      deepEqual({'title': 'T'},
          stdutil.transformRequest(hctx(queryPoint, {},
              {'x_trace': 't1', 'session_id': 's1', 'page_size': 2, 'title': 'T', r'$action': 'a'})));
    });

    test('a raw request body is sent as given', (t) {
      final ctx = hctx(<String, dynamic>{
        'body': {'kind': 'raw', 'media': 'text/plain'},
      }, {}, {r'$body': 'hello'});
      ctx.op = Operation({'name': 'create', 'entity': 'x', 'input': 'data'});
      equal('hello', stdutil.prepareBody(ctx));
    });
  });
}
