import 'dart:convert';

import 'voxgig_struct.dart' as vs;

import 'PrepareHeadersUtility.dart' show cookieKeep;

const OPTION_apikey = 'apikey';
const OPTION_secret = 'secret';

const NOTFOUND = '__NOTFOUND__';

dynamic prepareAuth(dynamic ctx) {
  final client = ctx.client;
  final spec = ctx.spec;

  if (null == spec) {
    return ctx.error(
        'auth_no_spec', 'Expected context spec property to be defined.');
  }

  final options = client.options();

  // The credential travels where `auth.in` says (a header, the query or a
  // cookie), under `auth.name`; a header name travels lower-cased.
  final where = _authIn(options);
  final name = _authName(options, where);

  // Public APIs that need no auth omit the options.auth block entirely.
  if (null == vs.getprop(options, 'auth')) {
    _clearCredential(spec, where, name);
    return spec;
  }

  final prefix = vs.getpath(options, 'auth.prefix');

  final apikey = vs.getprop(options, OPTION_apikey, NOTFOUND);
  final noApikey = NOTFOUND == apikey || null == apikey || '' == apikey;

  // True HTTP Basic Auth joins the two credentials, base64-encoded; a single
  // token can never authenticate against an API that checks
  // `Authorization: Basic base64(user:pass)`. Basic is a header scheme, and
  // the password may be empty (RFC 7617).
  if ('header' == where && true == vs.getpath(options, 'auth.basic')) {
    final secret = vs.getprop(options, OPTION_secret, NOTFOUND);
    final pass = (NOTFOUND == secret || null == secret) ? '' : secret.toString();

    if (noApikey) {
      _clearCredential(spec, where, name);
    } else {
      final b64 = base64Encode(utf8.encode(apikey.toString() + ':' + pass));
      // The joined, encoded pair is a wire form neither credential's own
      // registration covers.
      ctx.utility.cleanAdd(ctx, b64);
      vs.setprop(spec.headers, name, _prefixed(prefix, b64));
    }

    return spec;
  }

  if (noApikey) {
    _clearCredential(spec, where, name);
  } else if ('query' == where) {
    vs.setprop(spec.query, name, apikey.toString());
  } else if ('cookie' == where) {
    _setCookie(spec.headers, name, apikey.toString());
  } else {
    vs.setprop(spec.headers, name, _prefixed(prefix, apikey));
  }

  return spec;
}

String _authIn(dynamic options) {
  final where = vs.getpath(options, 'auth.in');
  final lower = null == where ? '' : where.toString().toLowerCase();
  return 'query' == lower || 'cookie' == lower ? lower : 'header';
}

String _authName(dynamic options, String where) {
  final name = vs.getpath(options, 'auth.name');
  final given = null == name || '' == name ? 'Authorization' : name.toString();
  return 'header' == where ? given.toLowerCase() : given;
}

// A raw credential (empty prefix, e.g. an apiKey scheme) goes in as-is; only
// a non-empty prefix (Bearer/Basic/OAuth) is space-joined.
dynamic _prefixed(dynamic prefix, dynamic credential) {
  return (null != prefix && '' != prefix)
      ? prefix.toString() + ' ' + credential.toString()
      : credential;
}

void _clearCredential(dynamic spec, String where, String name) {
  if ('query' == where) {
    vs.delprop(spec.query, name);
  } else if ('cookie' == where) {
    _setCookie(spec.headers, name, null);
  } else {
    vs.delprop(spec.headers, name);
  }
}

// A cookie has no header of its own: the credential is one `name=value`
// piece of the cookie header, beside the caller's other cookies.
void _setCookie(dynamic headers, String name, String? value) {
  final existing = vs.getprop(headers, 'cookie');
  final kept =
      existing is String ? cookieKeep(existing, [name]) : <String>[];
  if (null != value) {
    kept.add(name + '=' + value);
  }
  if (kept.isEmpty) {
    vs.delprop(headers, 'cookie');
  } else {
    vs.setprop(headers, 'cookie', kept.join('; '));
  }
}
