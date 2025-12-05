# Changelog

## [0.2.7-beta.1](https://github.com/pleaseai/mcp-gateway/compare/mcp-v0.2.6-beta.1...mcp-v0.2.7-beta.1) (2025-12-05)


### Features

* **mcp:** implement scope-based index storage ([#38](https://github.com/pleaseai/mcp-gateway/issues/38)) ([afb5e25](https://github.com/pleaseai/mcp-gateway/commit/afb5e25dac96104ab6a93f3f70f9064356e019ae))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @pleaseai/mcp-core bumped to 0.1.7-beta.1

## [0.2.6-beta.1](https://github.com/pleaseai/mcp-gateway/compare/mcp-v0.2.5-beta.1...mcp-v0.2.6-beta.1) (2025-12-05)


### Features

* **mcp:** implement automatic index regeneration on serve ([#34](https://github.com/pleaseai/mcp-gateway/issues/34)) ([8403416](https://github.com/pleaseai/mcp-gateway/commit/840341609e197aa88f30a86e4d60709de93f7301))


### Bug Fixes

* **mcp:** add [@beta](https://github.com/beta) tag to CLI usage templates ([#36](https://github.com/pleaseai/mcp-gateway/issues/36)) ([aa4f677](https://github.com/pleaseai/mcp-gateway/commit/aa4f677812c2c0820fc5ce62d330df1ecee5bab9))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @pleaseai/mcp-core bumped to 0.1.6-beta.1

## [0.2.5-beta.1](https://github.com/pleaseai/mcp-gateway/compare/mcp-v0.2.4-beta.1...mcp-v0.2.5-beta.1) (2025-12-04)


### Features

* **core:** implement hybrid search with RRF fusion ([#29](https://github.com/pleaseai/mcp-gateway/issues/29)) ([3f676fd](https://github.com/pleaseai/mcp-gateway/commit/3f676fd7ac6e396058eda50cc4956b1563264936))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @pleaseai/mcp-core bumped to 0.1.5-beta.1

## [0.2.4-beta.1](https://github.com/pleaseai/mcp-gateway/compare/mcp-v0.2.3-beta.1...mcp-v0.2.4-beta.1) (2025-12-04)


### Features

* **oauth:** add port retry logic for OAuth callback server ([#27](https://github.com/pleaseai/mcp-gateway/issues/27)) ([d825140](https://github.com/pleaseai/mcp-gateway/commit/d8251404f0033f8d8e8227f25e0fda3f612163cf))

## [0.2.3-beta.1](https://github.com/pleaseai/mcp-gateway/compare/mcp-v0.2.2-beta.1...mcp-v0.2.3-beta.1) (2025-12-04)


### Features

* **embedding:** add dtype option for local embedding providers ([#18](https://github.com/pleaseai/mcp-gateway/issues/18)) ([c55ea4d](https://github.com/pleaseai/mcp-gateway/commit/c55ea4d1bcf617310b02a6bdae571f9c440697f8))
* **mcp:** add CLI call command with permission check support ([#20](https://github.com/pleaseai/mcp-gateway/issues/20)) ([c5d97d3](https://github.com/pleaseai/mcp-gateway/commit/c5d97d3a9ca75539de662d492a27e1f406c3ab44))
* **release:** add homebrew and binary distribution support ([#25](https://github.com/pleaseai/mcp-gateway/issues/25)) ([60149b4](https://github.com/pleaseai/mcp-gateway/commit/60149b431164a76f15ab81d879a5789d18f0a741))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @pleaseai/mcp-core bumped to 0.1.4-beta.1

## [0.2.2-beta.1](https://github.com/pleaseai/mcp-please/compare/mcp-v0.2.1-beta.1...mcp-v0.2.2-beta.1) (2025-12-03)


### Features

* **mcp:** add OAuth 2.1 authentication support for remote MCP servers ([#5](https://github.com/pleaseai/mcp-please/issues/5)) ([7344372](https://github.com/pleaseai/mcp-please/commit/7344372a420fa8254296dafeeebbc00afe63525b))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @pleaseai/mcp-core bumped to 0.1.3-beta.1

## [0.2.1-beta.1](https://github.com/pleaseai/mcp-please/compare/mcp-v0.2.0-beta.1...mcp-v0.2.1-beta.1) (2025-12-02)


### Bug Fixes

* **ci:** use bun publish for workspace protocol resolution ([62952ef](https://github.com/pleaseai/mcp-please/commit/62952ef0ed76391d5f2bc07e1e9ec6397aeeb74b))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @pleaseai/mcp-core bumped to 0.1.2-beta.1

## [0.2.0-beta.1](https://github.com/pleaseai/mcp-please/compare/mcp-v0.1.0-beta.1...mcp-v0.2.0-beta.1) (2025-12-02)


### ⚠ BREAKING CHANGES

* Package names changed

### Features

* **cli:** add mcp command for managing MCP server configurations ([f5ded3d](https://github.com/pleaseai/mcp-please/commit/f5ded3d1eea8614fea4b99c6aaa30c74d898d73d))
* **cli:** auto-add mcp.local.json to .please/.gitignore ([b07dbce](https://github.com/pleaseai/mcp-please/commit/b07dbcea6f0235d83e235f8c34870dae3df5a8b7))


### Bug Fixes

* **lint:** add root eslint config and fix lint errors ([56915f9](https://github.com/pleaseai/mcp-please/commit/56915f9315e429cd4911e92d6fc75f054fecf8b0))


### Code Refactoring

* consolidate server and cli into @pleaseai/mcp package ([1271a1f](https://github.com/pleaseai/mcp-please/commit/1271a1fff3544ff6b28b4f6413d922f1b9121422))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @pleaseai/mcp-core bumped to 0.1.1-beta.1
