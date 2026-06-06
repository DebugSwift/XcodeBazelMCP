.PHONY: help install build test lint typecheck check clean version-patch version-minor version-major publish deploy release release-patch release-minor release-major

PKG_VERSION := $(shell node -p "require('./package.json').version")

help:
	@echo "Available targets:"
	@echo "  install         Install dependencies"
	@echo "  build           Build the project"
	@echo "  test            Run tests"
	@echo "  lint            Run linter"
	@echo "  typecheck       Run TypeScript type checker"
	@echo "  check           Run lint + typecheck + test"
	@echo "  clean           Remove build artifacts"
	@echo "  version-patch   Bump patch version (x.y.Z)"
	@echo "  version-minor   Bump minor version (x.Y.0)"
	@echo "  version-major   Bump major version (X.0.0)"
	@echo "  publish         Publish current version to npm"
	@echo "  deploy          Bump patch, tag, push, and publish to npm"
	@echo "  release-patch   Bump patch, tag, push, and publish"
	@echo "  release-minor   Bump minor, tag, push, and publish"
	@echo "  release-major   Bump major, tag, push, and publish"
	@echo ""
	@echo "Current version: $(PKG_VERSION)"

install:
	npm install

build:
	npm run build

test:
	npm test

lint:
	npm run lint

typecheck:
	npm run typecheck

check: lint typecheck test

clean:
	rm -rf dist coverage

define bump-version
	npm version $(1) --no-git-tag-version
	git add package.json package-lock.json
	git commit -m "chore: bump version to v$$(node -p "require('./package.json').version")"
	git tag "v$$(node -p "require('./package.json').version")"
endef

version-patch:
	$(call bump-version,patch)

version-minor:
	$(call bump-version,minor)

version-major:
	$(call bump-version,major)

publish: build
	npm publish --access public

deploy: check version-patch
	git push --follow-tags
	$(MAKE) publish

release: check
	git push --follow-tags
	$(MAKE) publish

release-patch: check version-patch
	git push --follow-tags
	$(MAKE) publish

release-minor: check version-minor
	git push --follow-tags
	$(MAKE) publish

release-major: check version-major
	git push --follow-tags
	$(MAKE) publish
