
.PHONY: comments comments-test hooks vendor vendor-check
comments:
	node tools/comment-gate.cjs

comments-test:
	node --test tools/comment-gate.test.cjs

hooks:
	git config core.hooksPath .githooks

vendor:
	node build/vendor.js

vendor-check:
	node build/vendor.js --check
