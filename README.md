# Quillow skills

Portable agent skills for building Quillow blocks. The first skill,
**quillow-custom-block**, creates and edits static Custom Code widgets and delivers
a validated ZIP containing `manifest.json`, HTML, CSS, JavaScript, and local assets.

## Install

Requires **Node.js 22.20+** and a coding agent with file and command access.

```sh
npx skills add Quillow-co/skills --skill quillow-custom-block
```

Choose your agents in the installer (for example Claude Code, Codex, or Cursor).
Add `-g` to install across projects. The skill's ZIP tools include their runtime
dependencies: no additional `npm install`, Python, or system ZIP command is needed.
Installation from GitHub works after this repository's contents are pushed.

## Use

Ask your agent:

> Create a Quillow custom block: a consultation calculator with a light theme,
> session duration and quantity controls. Give me a ZIP I can upload.

For revisions:

> Update my existing Quillow block: change the accent color and add a 90-minute
> option. Preserve the existing functionality and generate a new ZIP.

For persistent block content:

> Create a price list block. Let me edit and save its items in the Quillow editor
> using block storage. Published visitors should only read the saved items.

For a separate config page:

> Add a settings screen to my block using editor.entrypoint. Let me save a title
> in block storage and show it in the published widget.

The optional `editor.entrypoint` extends `schemaVersion: 1`; it does not require
a new schema version. Quillow opens it from the block's settings button in the
editor. See [the config-page guide](skills/quillow-custom-block/references/config-page.md)
for a complete manifest and read/save examples. The default starter stays minimal
and does not require a settings page.

The agent keeps editable files, validates the resulting ZIP, and provides a file
path or downloadable artifact depending on its environment. Select that ZIP in
your Quillow Custom Code block's upload control. Quillow validates and applies
uploads automatically; no separate publish step is required. Your plan must
include Custom Code access.

The runtime supports local interactivity, live theme/layout updates, and optional
host-backed string storage for the block. Storage requires a compatible host and
the corresponding capabilities; only editor connections can write. It is not
private visitor storage. External APIs are opt-in through exact HTTPS origins in
`network.allowedOrigins` (manifest v1), using direct fetch with target CORS and no
proxy. See [the network guide](skills/quillow-custom-block/references/network.md).
CDN resources, browser storage, and general Quillow account/page data access
remain unavailable. See the skill's
[package contract](skills/quillow-custom-block/references/package-contract.md),
[runtime guide](skills/quillow-custom-block/references/runtime-and-layout.md), and
[storage guide](skills/quillow-custom-block/references/storage.md).

The starter includes SDK **0.5.0** as a local ESM module, `runtime.js`. Import
`Quillow`, `connect`, and `WidgetSDKError` from that file as needed; do not load it
as a classic script or expect `window.Quillow`. The starter starts the theme/layout
bridge in `app.mjs` and keeps its example interaction local. Connect to storage
only when the block needs persistent data.

SDK 0.5.0 enforces string-only storage in its types and runtime validation while
keeping KV protocol v1. Always send strings and explicitly serialize structured
settings; there is no automatic conversion. Widget manifest `schemaVersion` also
remains `1`. See
[SDK compatibility](skills/quillow-custom-block/references/storage.md#sdk-compatibility).

## Run the tools directly

From this repository (or adjust paths for the installed skill):

```sh
node skills/quillow-custom-block/scripts/package.mjs skills/quillow-custom-block/templates/starter ./custom-block-starter.zip
node skills/quillow-custom-block/scripts/validate.mjs ./custom-block-starter.zip
```

Package only a clean directory of widget files. The output must be outside it and
must not already exist. Use a new filename for each revision. Validation checks
the archive contract, not browser behavior or resource references.

## Development

```sh
npm ci
npm run format
npm run build
npm run check
```

Edit `src/` and rebuild; commit the generated `skills/quillow-custom-block/scripts/`
and `THIRD_PARTY_NOTICES` with source changes. The build also copies the pinned
`@quillow/custom-block-sdk` ESM bundle (`dist/index.js`) into
`templates/starter/runtime.js`, embeds its MIT license, and removes the source map
reference. This is not the package's theme-only standalone `dist/runtime.js`.
Commit that generated file when updating the SDK dependency and lockfile.
`check:build` detects stale bundles.
Prettier formats source, documentation, and templates using `.prettierrc.json`,
including import sorting. Generated bundles are excluded. Run `npm run format`
before rebuilding; `npm run format:check` verifies formatting without modifying
files and runs as part of `npm run check` in CI.
`npm test` includes malformed ZIP fixtures and standalone-bundle execution outside
the repository. Browser tests run separately:

```sh
npx playwright install chromium
npm run test:browser
```

To also exercise the examples against a locally built SDK without changing the
published dependency pin:

```sh
QUILLOW_SDK_TEST_ENTRY=/absolute/path/to/custom-block-sdk/dist/index.js npm run test:browser
```

This overrides only the browser fixture's runtime. It does not upgrade the
shipped starter bundle or establish release readiness.

The browser test uses a local HTTP host with the sandbox/CSP/CORS contract from
Quillow, plus parent bridge fixtures for live theme, font stylesheet, layout
updates, and storage connections. Storage tests use a scripted host fixture,
not the production backend. Font stylesheet responses are mocked for deterministic
offline testing; this does not verify Google Fonts delivery in production. CI runs
these tests along with archive tests and bundle checks.

### Contract maintenance

The manifest contract was checked against `quillow-apis`'s
`apps/api/internal/entities/widget_package/package.go` and
`apps/api/internal/services/widget_packages/archive.go`, including editor entrypoint
tests, on 2026-11-08. Static hosting is maintained in `quillow-widget-host`.
Recheck these sources whenever the backend contract changes. Keep limits,
documentation, fixtures, and starter synchronized. The local validator
intentionally enforces canonical manifest spelling and valid Unicode instead of
relying on Go decoder quirks.

### Installation smoke test

Before publishing, install from this directory into a disposable project:

```sh
npx skills add /absolute/path/to/skills --skill quillow-custom-block -a claude-code -a codex --copy -y
```

Check both installed copies include scripts, references, and the starter. Run the
packaging command from an installed copy. Then exercise a creation/revision prompt
in each target agent; installation compatibility alone does not verify agent behavior.
