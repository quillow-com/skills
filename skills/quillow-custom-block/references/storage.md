# Host-backed block storage

The string-storage contract exposes `connect()` and one text key/value store,
`widget.storage`. Use it for persistent block settings or authored content.
Storage belongs to the connected block, not the running code version or visitor.
There are no public/private namespaces, `scope` option, or caller-supplied block ID.
`versionId` identifies the running code; it does not select a storage namespace.

For an optional settings screen, see [the config-page guide](config-page.md).
Its `editor.entrypoint` uses the same block storage as the main entrypoint; no
separate storage scope or manifest permission is needed. Read settings on startup:
there is no cross-session subscription.

## SDK compatibility

String storage, theme/layout and widget manifest `schemaVersion` all use **v1**.
The starter bundles the released SDK **0.5.0**, which enforces string-only storage
in its TypeScript types and runtime validation. Non-string values, zero bytes,
and lone surrogates are rejected locally with `INVALID_ARGUMENT` before a write
is sent. Empty strings are valid. There is no automatic conversion: serialize
structured settings explicitly and validate parsed data after reading.

Existing SDK 0.4.0 widgets can still exchange strings over the same protocol, but
their broader JSON input support does not change the host/API's string-only
contract. New ZIPs should use the bundled 0.5.0 runtime. Already uploaded ZIPs are
not upgraded automatically. Local browser tests can also use a built SDK through
`QUILLOW_SDK_TEST_ENTRY`.

**Do not store secrets or private visitor data.** Public connections may read the
block's data when granted read capabilities. Public visitors cannot write, so this
is not a backend for submissions, visitor-specific preferences, or shared counters
updated by visitors. Do not silently substitute browser storage or fake persistence.

## Connect from the starter

Import from the local ESM bundle, not a CDN or bare npm import inside the ZIP:

```js
import { connect, WidgetSDKError } from './runtime.js'

// Install the local UI's event handlers first. Start storage work independently;
// do not make the rest of the block wait for a host connection.
async function showSavedSettings() {
  const status = document.querySelector('#status')
  let widget

  try {
    widget = await connect({ timeout: 10_000, requestTimeout: 10_000 })
    if (!widget.capabilities.includes('storage.get')) {
      status.textContent = 'Saved settings are unavailable.'
      return
    }

    const entry = await widget.storage.get('settings')
    status.textContent =
      entry === null
        ? 'No saved settings yet.'
        : 'Saved settings are available.'
  } catch (error) {
    status.textContent =
      error instanceof WidgetSDKError
        ? `Storage is unavailable (${error.code}).`
        : 'Unable to load saved settings.'
  } finally {
    // This example performs a single read. An editable component should retain
    // its connection until that component is disposed instead.
    widget?.destroy()
  }
}

void showSavedSettings()
```

`connect()` works without options. Both timeouts default to 10 seconds and must
be positive integer milliseconds. The returned widget exposes `blockId`,
`versionId`, `mode` (`editor` or `public`), and a frozen `capabilities` array.
Treat this context as read-only. Check each operation's capability separately:

| Operation        | Capability       | Mode                 |
| ---------------- | ---------------- | -------------------- |
| Read one entry   | `storage.get`    | `editor` or `public` |
| List entries     | `storage.list`   | `editor` or `public` |
| Create or update | `storage.set`    | `editor` only        |
| Delete           | `storage.delete` | `editor` only        |

Public writes fail even if the host mistakenly advertises write capabilities.
The host/backend also authorize requests; SDK checks are not a security boundary.
Use `widget.mode` and capabilities for storage controls, not theme CSS attributes.

**Host support is required.** Outside an iframe, `connect()` rejects with
`HOST_UNAVAILABLE`. An absent or theme-only host causes `CONNECT_TIMEOUT`. KV
connections require a secure context and host `MessageChannel` support. Local
HTTP on localhost/127.0.0.1 is suitable for browser fixtures; arbitrary insecure
HTTP is not. Keep the fallback UI usable and do not promise persistence without
a successful connection.

When the embedding origin is known, optionally pass its exact HTTP(S) origin as
`parentOrigin` (no path or credentials). Do not hardcode an example domain into a
delivered block. Without it, the SDK trusts the direct parent that completes the
validated handshake; this is not proof that the parent is operated by Quillow.
The host derives the block identity and performs backend requests. Never put
user tokens, authenticated GraphQL calls, or a custom bridge in widget code.

## Read, create, update, and delete

The following snippets assume an open `widget` connection with the corresponding
capabilities. Read/write examples require both `storage.get` and the relevant
write capability. Only enable save/delete controls in editor mode, and handle
rejections even after checking permissions.

```js
let settings = await widget.storage.get('settings')
```

A missing entry is `null`. A present entry contains `key`, string `value`,
`revision`, `createdAt`, and `updatedAt`. An empty string is an existing value,
not a missing entry. The literal text `'null'` is also a string, not null.
Timestamps remain RFC 3339 strings. Validate application-specific content before
rendering it, and use text-safe DOM APIs.

Create only, without overwriting an existing key:

```js
const created = await widget.storage.set('new-title', 'Hello')
```

Save a new or previously loaded settings entry:

```js
if (widget.mode === 'editor' && widget.capabilities.includes('storage.set')) {
  settings = await widget.storage.set(
    'settings',
    JSON.stringify({ title: 'Updated title' }),
    { expectedRevision: settings?.revision }
  )
}
```

Omitting `expectedRevision` (or using `undefined`) means **create only**, not
upsert. Updating an existing key requires its last returned revision. Revisions
are opaque strings: never calculate, increment, or reuse a stale token. Keep the
entry returned by each successful save for the next edit. Serialize saves from
one component so it does not race against itself.

Delete using the current entry's revision:

```js
if (
  settings !== null &&
  widget.mode === 'editor' &&
  widget.capabilities.includes('storage.delete')
) {
  await widget.storage.delete('settings', {
    expectedRevision: settings.revision,
  })
  settings = null
}
```

Deletion requires a revision and resolves to literal `true` only when confirmed.
Do not delete and recreate keys to bypass conflicts.

## List and paginate

```js
let after
do {
  const page = await widget.storage.list({ limit: 50, after })
  for (const entry of page.entries) {
    // Validate and render entry.value with your application's own logic.
  }
  after = page.nextCursor
} while (after !== null)
```

`list()` returns `{ entries, nextCursor }`. The default limit is 50; allowed
limits are integers from 1 to 100. Fetch each page explicitly. Pass the non-null
cursor back unchanged; do not derive it from a key or send `after: null`.
For large views, load pages on demand instead of keeping all data in memory.

## Strings, serialization, and quotas

- Keys are 1–128 UTF-8 bytes, with no control characters or lone surrogates.
  Length is in bytes, not JavaScript characters. Keys are not trimmed or normalized.
- Values must be strings. Null, booleans, numbers, objects, arrays, `undefined`,
  and other types are rejected, not automatically converted. Empty strings,
  whitespace, quotes, newlines, and Unicode are preserved exactly. Zero bytes and
  lone surrogates are invalid; PostgreSQL text cannot store a zero byte.
- JSON is optional. Use ordinary text for titles or Markdown, and explicitly call
  `JSON.stringify` / `JSON.parse` for structured settings. Catch parse failures and
  validate the decoded shape. Do not parse arbitrary values or treat malformed
  saved data as an empty entry that can be overwritten.
- Existing JSON-backed values are migrated to serialized JSON text unchanged:
  an object becomes `'{"title":"Hello"}'`, JSON null becomes `'null'`, and old
  JSON strings retain their surrounding quotes. Any data migration belongs to
  the widget; the SDK does not guess or automatically decode old values.
- The backend currently allows **64 KiB of UTF-8 text per value**, **256 entries**,
  and **1 MiB per block**, including keys. JSON transport escaping does not count
  toward the value size. The host/backend enforce quotas;
  they are not archive limits or guarantees about future backend configurations.

## Errors and safe recovery

`WidgetSDKError` extends `Error` and exposes `code`, optional JSON `details`, and
`mutationMayHaveSucceeded`. Backend codes, including unknown future codes, pass
through unchanged. Catch errors around both connection setup and storage calls.

| Code                                               | Response                                                                                                   |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `widget_storage_conflict`                          | Read again, preserve the user's unsaved edit, and let them resolve the conflict. Never silently overwrite. |
| `widget_storage_quota_exceeded`                    | Explain the limit and let the editor reduce data.                                                          |
| `widget_storage_invalid` / `INVALID_ARGUMENT`      | Correct the key, string value, revision, or options; do not retry unchanged input.                         |
| `widget_storage_not_found`                         | Refresh the affected entry and update the UI.                                                              |
| `PERMISSION_DENIED` or backend authorization codes | Show a read-only/unavailable state.                                                                        |
| `HOST_UNAVAILABLE` / `CONNECT_TIMEOUT`             | Keep local behavior usable; storage was not connected.                                                     |
| `REQUEST_TIMEOUT`                                  | Report the timeout; inspect `mutationMayHaveSucceeded` for writes.                                         |
| `DISCONNECTED` / `DESTROYED`                       | Stop using this session; reconnect explicitly only when needed.                                            |
| `PROTOCOL_MISMATCH` / `PROTOCOL_ERROR`             | Report incompatibility or invalid host data; do not bypass validation.                                     |

**Never automatically retry mutations.** A write timeout does not prove failure.
When `mutationMayHaveSucceeded` is true, the write/delete may already be committed.
Re-read the affected key and explicitly reconcile it with the intended edit. If
the session is closed, open a new one before reading. Do not blindly resend or
replace the revision with a newer one to force an overwrite. A timeout of one
request does not by itself close an otherwise healthy connection.

Preserve unsaved edits while showing conflicts or uncertain outcomes. When reads
are also unavailable, report that the result cannot yet be confirmed rather than
claiming success/failure. Unknown errors need an honest error state, not fake data.

## Connection lifetime

Each `connect()` creates an independent `MessagePort` session. Retain one for the
component's work and call `widget.destroy()` when disposing it. Destruction is
idempotent, clears timers/handlers, and rejects pending requests with `DESTROYED`.
It does **not** cancel or roll back a mutation already sent to the host.

The SDK closes sessions on host disconnect, document `pagehide`, invalid protocol
messages, decode failures, or missed heartbeats. Heartbeats pause while hidden.
There is no automatic reconnect or request replay. The host must terminate a
session when its block identity, version, mode, or capabilities change.

Storage is independent of `Quillow.start()` / `ready()` / `subscribe()`: connecting
does not apply theme styles, and destroying either bridge does not destroy the
other. Keep the starter's theme/layout startup when adding storage. See
[the runtime guide](runtime-and-layout.md) for sandbox testing and migration from
the older global runtime.
