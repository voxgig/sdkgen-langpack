// VENDORED: @voxgig/plugin sdk-20261125-1959-0 (dart/lib/catalog.dart)
// Source: https://github.com/voxgig/plugin @ 8605cdc5e68a691130ae9b585baf8c0091a66351  [tag: sdk-20261125-1959-0]
// License: MIT (c) voxgig - see repository LICENSE. Do not edit: resync from upstream.
/// The definition catalog (section 10.1).
///
/// A definition is registered once and may back many instances. Option
/// shapes are validated AT REGISTRATION, not when a document happens to
/// exercise a key - so a malformed shape fails once, and in the same place
/// everywhere (section 9.4).
library;

import 'types.dart' as t;
import 'ref.dart' as r;
import 'config.dart' as config;

class Catalog {
  final Map<String, dynamic> _defs = {};

  void add(dynamic definition) {
    final name = t.get(definition, 'name');
    if (definition is! Map || !r.checkName(name)) {
      final shown = definition is Map ? name : definition;
      t.fail('plugin_definition_name', 'invalid definition name: $shown');
    }
    // Validate the shape HERE. Deferring it to resolution time means a
    // malformed shape surfaces at a different moment in every host that
    // loads it, which is the divergence the stated domain exists to prevent.
    final shape = t.get(definition, 'shape');
    if (shape != null) config.checkShape(shape);
    _defs[name as String] = definition;
  }

  dynamic get(String name) => _defs[name];

  bool has(String name) => _defs.containsKey(name);

  List<String> names() => _defs.keys.toList()..sort();
}

Catalog makeCatalog([List<dynamic>? definitions]) {
  final catalog = Catalog();
  for (final d in definitions ?? const []) {
    catalog.add(d);
  }
  return catalog;
}
