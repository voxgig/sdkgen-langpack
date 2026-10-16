// VENDORED: @voxgig/plugin sdk-20260908-1556-0 (dart/lib/plugin.dart)
// Source: https://github.com/voxgig/plugin @ caa404b2dfa206d77db6c2869e5b31c2a3202b2d  [tag: sdk-20261016-0845-0]
// License: MIT (c) voxgig - see repository LICENSE. Do not edit: resync from upstream.
/// The canonical surface `make parity` checks (AGENTS.md section 4). Small
/// on purpose (section 19): everything else is methods on the host and
/// instance types, because a library that grows a second public entry point
/// per feature is a library twenty ports pay for twice.
library;

export 'types.dart';
export 'ref.dart';
export 'version.dart';
export 'capability.dart';
export 'resolve.dart';
export 'export.dart';
export 'order.dart';
export 'point.dart';
export 'config.dart';
export 'env.dart';
export 'graph.dart';
export 'depend.dart';
export 'catalog.dart';
export 'host.dart';
