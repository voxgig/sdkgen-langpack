# Implementation rationale

Large Dart model payloads are emitted as JSON data and decoded into maps and lists. Preserve the numeric and container types that the literal representation would provide.

Compute entity type names before emitting declarations. Name initialization can be lazy, including for fieldless placeholder entities, so reading an unset name produces invalid output.

Sources: [Dart configuration](.sdk/src/cmp/dart/Config_dart.ts), [Dart entity types](.sdk/src/cmp/dart/EntityTypes_dart.ts).
