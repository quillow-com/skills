# Config pages

A config page is an optional HTML entrypoint in the same widget ZIP. Use it for
authoring settings or content without putting editor-only controls into the
published block. The main `entrypoint` stays the rendered widget; `editor.entrypoint`
opens a separate settings screen. This extends **`schemaVersion: 1`**; there is no
v2 manifest or `config`, `settings`, or storage-permissions property.

Read [the package contract](package-contract.md) and [the storage guide](storage.md)
first. The bundled SDK supports string storage over KV protocol v1; the manifest
also stays v1. The basic starter intentionally has no config page.

## Add the page to a package

Keep the existing main files and add a settings directory:

```text
my-block/
├── manifest.json
├── index.html
├── app.mjs
├── style.css
├── runtime.js
└── settings/
    ├── editor.html
    └── editor.mjs
```

Use this `manifest.json`, with a descriptive name for the actual block:

```json
{
  "schemaVersion": 1,
  "name": "Configurable greeting",
  "entrypoint": "index.html",
  "editor": {
    "entrypoint": "settings/editor.html"
  }
}
```

`editor.entrypoint` is relative to the **ZIP root**. It must point to an existing
`.html` file with exactly matching case. It can also be `editor.html` at the root.
Omit `editor` entirely when settings are unnecessary; old packages remain valid.
Both entrypoints may use the same file, but SDK `mode: 'editor'` alone cannot tell
the settings iframe from the editor's grid preview. Prefer separate files when
they need different UIs; do not invent an SDK config-page mode.

In `settings/editor.html`, load `./editor.mjs` as an ES module. In that module,
import from **`../runtime.js`**, not `./runtime.js`, a CDN, or a bare npm name.
Reuse that same local SDK bundle; keep one theme bridge and one storage connection
per document. Other script, stylesheet, and asset paths are also relative to the
file that contains the reference. No build/install step runs after upload.

## How Quillow opens settings

After a valid package has been applied and published, Quillow exposes its optional
editor URL to the owner-facing editor. A **Custom Block settings** gear button
opens that URL in a sandboxed modal iframe. It is unavailable when there is no
editor entrypoint or the publication is blocked/not live. Upload the complete ZIP
normally; do not construct hosting URLs or call GraphQL from widget code.

The grid preview does not receive pointer events, so do not rely on inline
settings buttons there. The modal gets its own theme/layout bridge and an
editor-mode storage connection for the same block and code version. Its actual
iframe dimensions are larger than a grid cell: use responsive form layout and
allow vertical scrolling. Do not constrain the form to the small/medium/large
grid compositions or assume the SDK size attribute identifies a config page.

The main widget and settings page are separate documents. They share the block's
storage, not global variables. There is no cross-session storage subscription.
Quillow remounts the editor preview after the modal closes, so the main entrypoint
must read saved settings on startup. An already-open published page does not
automatically refresh; read again on an explicit refresh or subsequent load.

## Minimal settings example

The following example saves one `settings` entry containing JSON text for
`{ title }`. JSON is this example's choice, not a platform requirement. Adapt
its UI to the block's theme and add any required fields/validation. Do not use
form submission or browser storage. Nothing writes until the user clicks Save.

### `settings/editor.html`

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1"
    />
    <title>Block settings</title>
  </head>
  <body>
    <h1>Block settings</h1>
    <fieldset
      id="settings"
      disabled
    >
      <legend>Content</legend>
      <label for="title">Title</label>
      <input
        id="title"
        maxlength="80"
        value="Hello"
      />
      <button
        id="save"
        type="button"
      >
        Save
      </button>
    </fieldset>
    <p
      id="status"
      role="status"
    >
      Loading settings…
    </p>
    <script
      type="module"
      src="./editor.mjs"
    ></script>
  </body>
</html>
```

### `settings/editor.mjs`

```js
import { connect, Quillow, WidgetSDKError } from '../runtime.js'

if (window.parent !== window) Quillow.start()

const fields = document.querySelector('#settings')
const title = document.querySelector('#title')
const save = document.querySelector('#save')
const status = document.querySelector('#status')
let widget
let entry = null
let writable = false
let saving = false
let disposed = false

save.addEventListener('click', async () => {
  if (!writable || saving) return
  const value = title.value.trim()
  if (!value || value.length > 80) {
    status.textContent = 'Enter a title of 1–80 characters.'
    return
  }

  saving = true
  fields.disabled = true
  save.disabled = true
  status.textContent = 'Saving…'
  try {
    entry = await widget.storage.set(
      'settings',
      JSON.stringify({ title: value }),
      { expectedRevision: entry?.revision }
    )
    status.textContent = 'Saved.'
  } catch (error) {
    // Stop after any failure: never retry a mutation or adopt a new revision
    // automatically. Keep the input intact so the user can preserve their draft.
    writable = false
    const code = error instanceof WidgetSDKError ? error.code : 'unknown error'
    status.textContent =
      error instanceof WidgetSDKError && error.mutationMayHaveSucceeded
        ? 'Save outcome is uncertain. Copy your draft and compare saved data before trying again.'
        : `Unable to save (${code}). Copy your draft and reload settings to compare saved data.`
  } finally {
    saving = false
    fields.disabled = false
    save.disabled = !writable
  }
})

async function load() {
  try {
    widget = await connect()
    if (disposed) {
      widget.destroy()
      return
    }
    if (!widget.capabilities.includes('storage.get')) {
      status.textContent = 'Saved settings are unavailable.'
      return
    }
    entry = await widget.storage.get('settings')
    if (entry !== null) {
      const value = JSON.parse(entry.value)?.title
      if (typeof value !== 'string' || !value.trim() || value.length > 80) {
        throw new Error('Unsupported saved settings')
      }
      title.value = value
    }
    writable =
      widget.mode === 'editor' && widget.capabilities.includes('storage.set')
    fields.disabled = !writable
    status.textContent = writable ? 'Ready to edit.' : 'Settings are read-only.'
  } catch {
    status.textContent = 'Settings could not be loaded. No data was changed.'
  }
}

window.addEventListener('pagehide', () => {
  disposed = true
  widget?.destroy()
  Quillow.destroy()
})

void load()
```

The initial read must finish before saving is enabled. A missing entry is `null`:
passing `undefined` as `expectedRevision` creates only, while an update uses the
last revision returned by `get` or a successful `set`. Saves are serialized; the
entry returned by each save supplies the revision for the next one. The example
preserves the draft and disables further saves after errors. For production,
offer an explicit read/compare recovery flow for conflicts and uncertain writes;
never silently overwrite another edit or discard the user's draft.

## Read settings in the main widget

Give `index.html` a heading with `id="widget-title"` and a status element with
`id="settings-status"` and `role="status"`. Keep useful default content before
connecting. Add this to the main `app.mjs`, preserving its existing guarded
`Quillow.start()` call and local interaction. Reuse existing SDK imports if any:

```js
import { connect } from './runtime.js'

async function loadSettings() {
  let widget
  try {
    widget = await connect()
    if (!widget.capabilities.includes('storage.get')) {
      document.querySelector('#settings-status').textContent =
        'Saved settings are unavailable.'
      return
    }
    const entry = await widget.storage.get('settings')
    if (entry !== null) {
      const title = JSON.parse(entry.value)?.title
      if (typeof title !== 'string' || !title.trim() || title.length > 80) {
        throw new Error('Unsupported saved settings')
      }
      document.querySelector('#widget-title').textContent = title
    }
  } catch {
    document.querySelector('#settings-status').textContent =
      'Saved settings could not be loaded.'
  } finally {
    widget?.destroy()
  }
}

void loadSettings()
```

This is one read, with no writes or automatic retries. It works in editor and
public mode when granted `storage.get`. Use `textContent`, not `innerHTML`, for
authored strings. Parse JSON only for keys whose application contract specifies
JSON; other keys can contain any text, including empty strings. Catch malformed
JSON without overwriting it. Production widgets should validate the complete settings shape
and define migrations when changing that shape across code versions: storage
belongs to the block and survives code replacement.

## Security and verification

- The editor HTML and other package assets are publicly addressable. The settings
  button is an editor affordance, **not an authentication boundary**. Never embed
  credentials, tokens, private visitor data, or secrets in files or block storage.
- Check `widget.mode` and each capability, even on the settings page. Public
  connections cannot write. The host/backend enforce authorization; a URL, theme
  attribute, or hidden button does not grant write access.
- Keep the sandbox/CSP and SDK bridge; do not add direct network calls, an ad-hoc
  message protocol, a parent-DOM integration, or a custom save/close/publish API.
- Package and validate the whole ZIP with the bundled tools. Test missing/wrong-case
  editor files, nested imports, initial loading, first and repeated saves, closing
  and reopening the modal, and refreshed preview/public reads. Also test absent
  hosts, read-only mode, missing capabilities, conflicts, and uncertain writes.
- Archive validation checks entrypoints, not JS resource references or browser
  behavior. Test the settings form in a sandboxed iframe at modal-like narrow and
  wide sizes; continue testing the main widget at all three grid sizes.
