# ProjectName SDK — Haskell build/test.
# Requires GHC (`ghc`) on PATH. No third-party dependencies (only the GHC
# boot libraries: base, containers, array, time). The vendored voxgig struct
# port lives under src/ (VoxgigStruct.hs + Vregex.hs).

.PHONY: test build clean

BUILDDIR := .hsbuild

# Build and run the full SDK test suite + vendored struct corpus. The runner
# reads the shared spec at ../.sdk/test/test.json (run from this directory).
# The corpus can be newer than the struct port, and a case the port cannot
# settle may allocate without bound: under the heap cap it fails as one case.
# GHCRTS=-M<size> raises the cap.
test:
	@mkdir -p $(BUILDDIR)
	ghc -O0 -rtsopts -with-rtsopts=-M2g -isrc -itest -itest/vendor/omni -outputdir $(BUILDDIR) -o $(BUILDDIR)/runner test/Runner.hs
	$(BUILDDIR)/runner

# Type-check only (a clean compile = pass).
build:
	ghc -fno-code -isrc -itest -itest/vendor/omni test/Runner.hs

clean:
	rm -rf $(BUILDDIR) src/*.hi src/*.o test/*.hi test/*.o
