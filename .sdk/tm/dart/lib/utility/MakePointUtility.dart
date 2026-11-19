import 'voxgig_struct.dart' as vs;

import 'PrepareMethodUtility.dart' show allowed;

dynamic makePoint(dynamic ctx) {
  if (null != ctx.out['point']) {
    return ctx.point = ctx.out['point'];
  }

  final op = ctx.op;
  final options = ctx.options;

  final allowop = vs.getpath(options, 'allow.op');
  if (!allowed(allowop, op.name)) {
    return ctx.error(
        'point_op_allow',
        'Operation "' +
            op.name.toString() +
            '" not allowed by SDK option allow.op value: "' +
            (allowop ?? '').toString() +
            '"');
  }

  if (0 == op.points.length) {
    return ctx.error(
        'point_no_points',
        'Operation "' + op.name.toString() + '" has no endpoint definitions.');
  }

  // Operation argument has priority, but also look in current data or match.
  final reqselector = 'data' == op.input ? ctx.reqdata : ctx.reqmatch;
  final selector = 'data' == op.input ? ctx.data : ctx.match;

  // A lone point still needs the call's action to agree with its own; the
  // selection below refuses a mismatch either way.
  if (1 == op.points.length &&
      vs.getprop(reqselector, r'$action') ==
          vs.getprop(op.points[0].select, r'$action')) {
    ctx.point = op.points[0];
  } else {
    dynamic point;
    var matched = false;
    for (var i = 0; i < op.points.length; i++) {
      final cand = op.points[i];
      final select = cand.select;
      var found = true;

      final exist = vs.getprop(select, 'exist');
      if (null != selector && exist is List) {
        for (var j = 0; j < exist.length; j++) {
          final existkey = exist[j];

          if (null == vs.getprop(reqselector, existkey) &&
              null == vs.getprop(selector, existkey)) {
            found = false;
            break;
          }
        }
      }

      // Action is only in operation argument.
      if (found &&
          vs.getprop(reqselector, r'$action') !=
              vs.getprop(select, r'$action')) {
        found = false;
      }

      if (found) {
        point = cand;
        matched = true;
        break;
      }
    }

    // select.exist can list more than the params needed to pick a point, so
    // nothing matches — fall back to the entity's own route rather than
    // whichever point came last.
    if (!matched) {
      // A request naming an action reaches here only because that action's
      // own point failed its exist test, so it is unbuildable whatever we
      // pick. Refuse it BEFORE choosing a fallback: the guard below compares
      // the chosen point's $action and would wave the request through
      // whenever the fallback lands on the action point itself.
      if (null != vs.getprop(reqselector, r'$action')) {
        return ctx.error(
            'point_action_invalid',
            'Operation "' +
                op.name.toString() +
                '" action "' +
                vs.getprop(reqselector, r'$action').toString() +
                '" is not valid.');
      }

      // A terminal parameter marks a record route (/boards/{id}); a
      // cross-reference ends in the relationship's name
      // (/posts/{id}/author). Failing that, the shallower path wins.
      bool terminalParam(dynamic p) {
        final parts = p.parts;
        if (parts.isEmpty) {
          return false;
        }
        final last = parts[parts.length - 1];
        return last is String && last.startsWith('{');
      }

      // A call without an action falls back to a point without one, as
      // generation does.
      final plain = op.points
          .where((cand) => null == vs.getprop(cand.select, r'$action'))
          .toList();
      if (plain.isEmpty) {
        return ctx.error(
            'point_action_required',
            'Operation "' +
                op.name.toString() +
                '" has only action endpoints; pass \$action to choose one.');
      }

      point = plain[0];
      for (final cand in plain) {
        if (terminalParam(cand) != terminalParam(point)) {
          if (terminalParam(cand)) {
            point = cand;
          }
        } else if (cand.parts.length < point.parts.length) {
          point = cand;
        }
      }
    }

    if (null != vs.getprop(reqselector, r'$action') &&
        null != point &&
        vs.getprop(reqselector, r'$action') !=
            vs.getprop(point.select, r'$action')) {
      return ctx.error(
          'point_action_invalid',
          'Operation "' +
              op.name.toString() +
              '" action "' +
              vs.getprop(reqselector, r'$action').toString() +
              '" is not valid.');
    }

    ctx.point = point;
  }

  return ctx.point;
}
