---
name: quillow-custom-block
description: Create or edit a responsive Quillow Custom Code block and deliver a validated, upload-ready ZIP with manifest.json. Use for custom Quillow widgets, interactive blocks, calculators, config pages, host-backed block storage, or changes to existing block packages.
compatibility: Requires Node.js 22.20+ and an agent able to create files and run commands. Browser testing is optional and requires browser tools.
---

# Quillow Custom Block

Deliver a polished static block and an actual ZIP the user can upload to Quillow.
Respond in the user's language. This skill works with any compatible coding agent;
do not assume a particular editor, terminal tool, installation path, or browser tool.

## Workflow

1. Read [the package contract](references/package-contract.md),
   [the runtime guide](references/runtime-and-layout.md), and
   [the design guide](references/design-guide.md).
2. Determine the purpose, essential content, interaction, assets, data, links,
   and visual direction. Use information already supplied and ask only questions
   that materially affect implementation. If the brief is incomplete, begin with:
   **What kind of block would you like to build?** Ask unresolved questions one
   at a time, then stop when the remaining decisions can be reasonably inferred.
   Do not ask which Quillow size to target or ask the user for pixel dimensions:
   every block must support small, medium, and large.
3. If the user asks for something basic or simple, says “match Quillow,”
   “general Quillow,” or “default Quillow,” or provides no visual direction,
   read and apply [the default style](references/default-style.md). Do not ask for
   a screenshot or invent an art direction from the content subject. A specific
   style request or copied creative prompt overrides the default; preserve its
   concept while improving fit, accessibility, and reliability.
4. The bundled SDK supplies live theme, layout, and editor/published context.
   For persistent block data, read [the storage guide](references/storage.md).
   `connect()` provides host-backed string storage when the host supports it:
   check each capability, write only in editor mode, and preserve revision tokens.
   Values must be strings; use explicit serialization for structured settings.
   The bundled SDK 0.6.0 enforces string-only storage over the existing v1 protocol;
   never pass objects directly or expect automatic serialization.
   This is shared block data, not private visitor storage. Browser storage and
   general Quillow account/page data remain unavailable. Resolve requests
   for those capabilities with the user; do not invent them or substitute fake data.
   For external APIs, read [the network guide](references/network.md). Use direct
   native fetch only to exact HTTPS origins declared in `network.allowedOrigins`;
   target CORS is required. No proxy, secret keys, or expanded asset permissions.
   For a separate settings/config page, also read [the config-page guide](references/config-page.md).
   Add an optional `editor.entrypoint` to the existing `schemaVersion: 1` manifest;
   do not invent a v2 manifest or a `config` property. Put authoring controls in this
   page when requested: the editor's grid preview does not receive pointer events.
   The page and main block share storage, not JavaScript state or a live subscription.
   The bundled SDK 0.6.0 supports `widget.openEditor()` with editor mode and the
   host's `editor.open` capability. When editing older blocks, feature-detect the
   method and fall back to Quillow's settings gear if their runtime lacks it.
   Follow the config-page guide for `EDITOR_UNAVAILABLE`, permission errors, and
   timeouts. Do not invent `openSettings()`, `Quillow.openEditor()`, a custom
   message protocol, or `window.open` to open the screen. Do not auto-open it on
   every startup: closing the modal remounts the preview and could cause a loop.
5. Find the installed directory containing this `SKILL.md`; call its absolute
   path `SKILL_DIR`. Check `node --version` (22.20+). Scripts and references are
   relative to this directory, not to the user's working directory. No package
   installation, Python, or system ZIP tool is needed.
6. For a new block, copy the contents of `templates/starter/` to a new working
   directory such as `my-block/` and customize them. Never edit the installed
   template. Prefer plain HTML/CSS/JS. Keep source/build tooling outside the
   directory that will be packaged. Replace all starter content and give the
   manifest a descriptive name.
   Keep the local `runtime.js` ESM bundle. Import `Quillow`, `connect`, and
   `WidgetSDKError` from `./runtime.js` as needed. Preserve the starter's guarded
   `Quillow.start()` call for theme/layout. Do not load this file as a classic
   script, expect `window.Quillow`, or add a second SDK instance. For older blocks,
   inspect their existing runtime/loading pattern before migrating to ESM.
7. For an existing block, inspect the files before editing and preserve unrelated
   behavior and user content. If only a ZIP was supplied, validate it first with
   `validate.mjs`, then use an available archive tool to extract it into a fresh
   directory while preserving paths. If extraction is unavailable, ask for the
   extracted files. Do not overwrite the original ZIP. Revisions use a new output
   filename.
8. Implement accessible controls, input validation, clear empty/error states, and
   responsive layouts using SDK size attributes, with these baseline test viewports:

   - Small: 156 × 156
   - Medium: 336 × 156
   - Large: 336 × 336

   Use `data-quillow-size` for composition and actual available dimensions for
   fitting content. Page viewport mode is distinct from block size. Keep CSS
   fallbacks for initial rendering and previews without host context.

   Treat these as three intentional compositions, not one canvas scaled up or
   down. Remove low-priority framing before shrinking type, truncating essential
   content, or adding scrollbars. Check every HTML/CSS/JS resource reference
   against the exact packaged filename, including capitalization; the archive
   validator does not inspect references.

9. If browser tools are available, serve the files through local HTTP and test in
   a sandboxed iframe with the documented CSP and CORS headers. Test all three
   exact viewports, keyboard interaction, touch/pointer behavior, reduced motion,
   live theme/font/layout changes without losing state, and the main interaction.
   If storage is used, also test public read-only behavior, missing capabilities,
   absent/legacy hosts, revision conflicts, and uncertain writes without retries.
   If a config page is included, test loading/saving in its modal, reopening it,
   and reading the saved data in the refreshed preview and published block.
   If SDK opening is used, also test the legacy-runtime fallback, public denial,
   missing screen versus missing capability, confirmation, timeout without retry,
   and repeated opening without additional modals.
   Plain `file://` or an unsandboxed tab is not a runtime
   compatibility check. Fix clipping, overlap, accidental scrolling, tiny targets,
   and unreadable text rather than reporting them as expected limitations. If no
   browser is available, say that visual/runtime checks were not performed.
10. Run the bundled commands, quoting paths with spaces:

    ```sh
    node "$SKILL_DIR/scripts/package.mjs" ./my-block ./my-block.zip
    node "$SKILL_DIR/scripts/validate.mjs" ./my-block.zip
    ```

    Replace `SKILL_DIR` with the actual path using the environment's syntax. The
    output must be outside the input directory and must not already exist. Resolve
    errors and rerun the relevant checks. Do not report success before the commands
    succeed. Do not include the skill itself in the widget ZIP.

11. Provide the actual ZIP download/attachment when supported; otherwise provide
    its full local path. Summarize the block in one or two sentences, state which
    checks ran, and note any intentionally reduced behavior at a particular size.
    Instruct the user to select the ZIP in Quillow's Custom Code upload control.
    Upload/application is handled by Quillow; there is no separate publish step
    in v1. Keep editable files for later revisions.

## Completion rules

- Never claim a ZIP exists if the environment only produced text/code snippets.
  If commands or file creation are unavailable, explain the limitation and provide
  runnable steps instead of a fictitious download link.
- A valid ZIP does not prove JavaScript behavior or visual quality. Report archive
  validation separately from browser checks.
- Package scripts and assets locally: no CDN scripts, analytics, secrets,
  server-side code, or installation steps inside the generated block. External API
  connections require `network.allowedOrigins` and working target CORS; keep the
  starter network-disabled unless the requested functionality needs an API.
  Host-provided font stylesheets managed by the SDK are the supported external
  font exception; do not add arbitrary remote fonts.
- Use the SDK for host-backed storage, not fetch/GraphQL, tokens, or a custom
  message protocol. Never store secrets in block data. Do not automatically retry
  mutations, overwrite conflicts, or treat a timed-out write as a confirmed failure.
- Config pages are optional and use the same package limits. Package the editor
  HTML and its local resources; use the SDK and revision-aware storage for settings.
  An editor file is publicly addressable, not an authentication boundary. Keep
  secrets out of both files and storage; enforce writes through mode/capabilities.
- For navigation in the main tab, use an absolute URL and `target="_top"` on
  links. For buttons, assign `window.top.location.href` to an absolute URL
  directly in the click handler. An ordinary link navigates inside the iframe;
  `_top` changes the main page. Follow the runtime guide's navigation examples.
- Navigation requires a user action; automatic redirects are blocked. Do not
  promise navigation after a timer or an asynchronous request. Do not recommend
  `target="_blank"` or `window.open`: the current sandbox blocks new windows.
- Do not add manifest properties for height, permissions, theme, or resizing.
