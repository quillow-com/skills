# Runtime and layout

Quillow serves static package files in an iframe. JavaScript executes in the
visitor's browser, not in Go or the hosting Worker. There is no server build step.

## Supported behavior

- Local DOM interaction, calculations, tabs, counters, and in-memory state.
- Relative scripts, ES modules, styles, images, and fonts from the package.
- Static data embedded in HTML or JavaScript.
- Host-backed string storage through the SDK, when the host supports it and grants
  the matching capabilities. Public connections can read; writes require editor
  mode. See [the storage guide](storage.md) before implementing persistence.
- An optional config page in `editor.entrypoint`, opened in the editor's settings
  modal. It shares block storage with the main widget but has a separate document
  and connection. See [the config-page guide](config-page.md) for implementation.

Use `./style.css`, `./app.mjs`, and `./assets/image.webp`, not `/assets/...`.
References in CSS and module imports are relative to their containing file.
If using a build tool, build locally and package only compatible output using
relative URLs, with no source maps or dependency manifests.

## Unavailable capabilities

- External scripts, arbitrary external fonts, APIs, fetch/XHR/WebSocket connections, workers,
  `eval`/`new Function`, nested frames, form submission, and privileged APIs.
- Cookies, localStorage, IndexedDB, or other browser storage. The supported
  persistence mechanism is the SDK's host-backed block storage, not visitor storage.
- Quillow account/page data, automatic iframe resizing, or a manifest height property.

Use ordinary inputs/buttons and event listeners for local interaction, not a
submitted form. In-memory state resets on reload; explicitly saved block data does
not. Do not use network requests even to load local JSON: `connect-src 'none'`
blocks them. Use a JS module instead.

## SDK bridge

KV, theme/layout and widget manifest all remain v1. The pinned SDK 0.4.0 supports
the string-based examples without a runtime upgrade. Always pass string values,
even though that SDK's older input types also accept other JSON data. See
[SDK compatibility](storage.md#sdk-compatibility).

The starter includes `@quillow/custom-block-sdk` **0.4.0** as a local ESM bundle,
`./runtime.js`. Its `app.mjs` imports the SDK and starts the theme/layout bridge:

```js
import { Quillow } from './runtime.js'

if (window.parent !== window) Quillow.start()
```

The HTML loads only the author module:

```html
<script
  type="module"
  src="./app.mjs"
></script>
```

Importing the SDK alone has no DOM side effects. This starter's `runtime.js` is
copied from the package's `dist/index.js`, not its standalone `dist/runtime.js`.
It does not auto-start or set `window.Quillow`. Do not load it as a classic script
or combine it with another SDK bundle. The default interaction is local; import
`connect` and `WidgetSDKError` from the same module only when storage is needed.

The host supplies live context without reloading the block:

- `theme`: mode, corner style, resolved CSS variables, and font stylesheet.
- `layout`: size (`1:1`, `2:1`, `2:2`), width/height in CSS pixels, and page
  viewport mode (`mobile` or `desktop`).
- `environment`: `editor` or `published`.

The SDK applies `data-quillow-theme`, `data-quillow-size`,
`data-quillow-viewport`, `data-quillow-corner-style`, and
`data-quillow-environment` to `<html>`. Use these and theme tokens in CSS; ordinary
DOM widgets need no subscription. For canvas/charts use
`Quillow.subscribe(render)`, which replays available context and receives full
snapshots. Call the returned unsubscribe function when disposing the component.

Do not block interaction on `Quillow.ready()`. Handle its timeout rejection if
using it. It does not wait for fonts; use the Font Loading API before
font-dependent measurements. Explicit startup/subscription requires an embedded
browser window; standalone previews should use CSS fallbacks. Use the SDK rather
than implementing a separate message protocol.

The SDK manages the host-provided font stylesheet, replacing/removing it on theme
changes. Google Fonts requires CSP allowances for its stylesheet and font origins.
This does not enable arbitrary network requests.

### Storage is a separate connection

`connect()` returns block identity, `mode` (`editor` or `public`), capabilities, and
`widget.storage`. The theme context's `environment: 'published'` corresponds to
storage's `mode: 'public'`; they are different field names and values. Theme
readiness does not establish a storage connection, and `connect()` applies no
theme styles. `Quillow.destroy()` and `widget.destroy()` dispose separate bridges.

Storage uses a host-provided `MessagePort`, not fetch/XHR. Keep `connect-src 'none'`
and the existing sandbox; do not enable network access or `allow-same-origin`.
A theme-only host can still update theme/layout while storage connections time out.
Keep the local UI usable and show an honest unavailable/read-only state as needed.

### Migrating an older block

Older ZIPs may use a classic `runtime.js` that auto-starts and exposes
`window.Quillow`. Do not simply replace that file with the ESM bundle. Remove its
classic script tag, import `Quillow` in the author module, and add the guarded
startup shown above. Replace global SDK references with imports. Keep one active
theme bridge, preserve existing behavior, and test the revised ZIP. Existing ZIPs
are not upgraded automatically.

## Navigation

An ordinary link opens its destination inside the widget's iframe. To navigate
the main page in the current tab, use an absolute URL and `target="_top"`:

```html
<a
  href="https://example.com/contact"
  target="_top"
  >Contact us</a
>
```

`_top` changes the main page rather than the iframe. For a button, assign
`window.top.location.href` directly in its click handler:

```html
<button
  id="contact"
  type="button"
>
  Contact us
</button>
<script>
  document.querySelector('#contact').addEventListener('click', () => {
    window.top.location.href = 'https://example.com/contact'
  })
</script>
```

Navigation requires a user action, such as clicking the link or button. Automatic
redirects are blocked. Keep button navigation synchronous in the click handler;
do not promise navigation after a timer or an asynchronous request.

Do not recommend `target="_blank"` or `window.open`: the current sandbox blocks
new windows and tabs. These navigation URLs are separate from package resource
URLs, which must remain relative.

## Layout

The block fills its assigned grid cell, not the browser's page. One package must
support all three baseline CSS-pixel viewports: small at 156 × 156, medium at
336 × 156, and large at 336 × 336. Medium and large have the same width, so use
the SDK size attribute when changing composition. Fit content to actual iframe
dimensions; keep height-aware media queries as a fallback without host context.
A narrow desktop block still has viewport mode `desktop`.

Use responsive widths, `box-sizing: border-box`, `min-width: 0`, and deliberate
overflow handling. Prefer intentional single-screen compositions for small and
medium; do not assume the parent will resize. Read
[the design guide](design-guide.md) for content-priority and review requirements.

Use labels, visible focus indicators, semantic controls, sufficient contrast,
and readable result/error states. Respect reduced motion if adding animation.
Avoid expensive continuous animation and unbounded work in event handlers.

## Browser verification

Serve through local HTTP. The wrapper should use:

```html
<iframe
  src="http://127.0.0.1:PORT/package/index.html"
  sandbox="allow-scripts allow-top-navigation-by-user-activation"
  referrerpolicy="no-referrer"
  title="Custom widget"
  style="width:100%;height:100%;border:0"
></iframe>
```

Do not add `allow-same-origin`. On package responses, use the host's CSP with
`PREFIX` replaced by the complete local package URL ending in `/`:

```text
sandbox allow-scripts allow-top-navigation-by-user-activation;
default-src 'none';
script-src 'unsafe-inline' PREFIX;
style-src 'unsafe-inline' PREFIX https://fonts.googleapis.com;
img-src data: PREFIX;
font-src PREFIX https://fonts.gstatic.com;
connect-src 'none';
worker-src 'none';
frame-src 'none';
object-src 'none';
base-uri 'none';
form-action 'none';
frame-ancestors https: http://localhost:* http://127.0.0.1:*
```

Serve correct MIME types and `Access-Control-Allow-Origin: *` for module/font
requests from the sandbox's opaque origin. Include `X-Content-Type-Options:
nosniff` and `Referrer-Policy: no-referrer`.

Exercise the main interaction, invalid/empty values, keyboard focus, and exactly
156 × 156, 336 × 156, and 336 × 336. Check console errors, missing assets, CSP
violations, clipping, accidental scrolling, and undersized controls. A plain
unsandboxed page does not reproduce this runtime.
If the widget includes navigation, verify that a click on its link or button
changes the main page. Keep top navigation restricted to user activation in both
the iframe sandbox and CSP; do not add `allow-top-navigation` or `allow-popups`.

For storage, add a parent fixture implementing the SDK's
[KV bridge contract](https://github.com/quillow-com/custom-block-sdk/blob/main/PROTOCOL.md).
Transfer a `MessagePort` into the sandboxed iframe; its opaque origin requires
`'*'` as the host's target origin, while the widget still validates the parent
window and HTTP(S) origin. Do not relax sandbox/CSP to make a test pass. Test editor
writes, public read-only mode, missing capabilities, pagination, conflicts,
timeouts, uncertain mutations, and disposal. A fixture is not proof of production
host/backend support.
