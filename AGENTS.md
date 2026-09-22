# sdkgen-langpack — agent guide

## More than one machine, with different software installed

This repository is worked on from MORE THAN ONE MACHINE, and from ephemeral
containers whose installed software differs from each other and from any
developer's workstation. A toolchain, a path or a version present in one is
routinely absent in the next.

**Never record an inventory of what is installed as though it were a property
of this repository.** A list of available compilers describes the machine it
was written on, and it is wrong as soon as it is read anywhere else.

**Never conclude that something cannot be built, run or verified without
checking the CURRENT environment first.** `command -v dart lake ghc` settles
it in a second. The reverse holds just as firmly: a note anywhere in this
repository saying a tool "was not available" is a fact about the environment
that note was written in, and never about yours. A target recorded as
unverified because some earlier machine lacked its compiler can usually just
be verified.

This matters here specifically. The suite type-checks every target's
components and generates a staged consumer project, all on Node alone — so it
runs green with no `dart`, no `lake` and no `ghc` anywhere on the machine. A
green build is not a compiled Dart, Haskell or Lean SDK, and whether you can
produce one is a question about your environment that only your environment
answers.

The same asymmetry applies to paths. `vendor/routes.json` gives each vendored
library a `local` sibling-checkout path; those are one layout offered as a
convenience, not a claim that the directory exists. `build/vendor.js` clones
into `vendor/.cache` when it does not, so vendoring works on a machine that
has never heard of that layout.

## Temporary local tool development

Prefer local symlinks to sibling tool checkouts when developing or testing
unreleased Voxgig tools together. Link to the actual package root (for example,
`apidef/ts` or `sdkgen/ts`), build that checkout, and verify that the consumer
resolves the linked code. Use existing validator local-path options where
available.

Do not create or copy `.zip`, `.tgz`, or `npm pack` snapshots into SDK projects
or ad hoc `vendor/` folders just to use local changes. Keep temporary links in
ignored dependency directories; keep machine-specific paths and temporary
`file:` dependencies out of committed manifests and lockfiles. Shared builds
and CI should use published versions or explicitly check out and build the
required source revisions.

Archives are appropriate when testing package contents or installation from a
packed release. Put those artifacts in a temporary test directory and clean
up artifacts created by the test afterward; do not scatter them across repos.


## Source code comments

Follow [COMMENT-POLICY.md](COMMENT-POLICY.md): comments are sparse and terse,
only for intricate or surprising code. Names carry intent; documents carry
requirements. Run `make comments comments-test` after editing source.

Durable implementation rationale is in [COMMENT-NOTES.md](COMMENT-NOTES.md).
