# Quillow package contract v1

Manifest checked against `quillow-apis` on 2026-11-08:
`apps/api/internal/entities/widget_package/package.go` and
`apps/api/internal/services/widget_packages/archive.go`, including its editor
entrypoint tests. Static hosting lives in `quillow-widget-host`. The backend
remains the authority.

```text
block.zip
├── manifest.json
├── index.html
├── style.css
├── app.mjs
├── runtime.js
└── assets/
    └── photo.webp
```

No outer project directory. Only the manifest and HTML entrypoint are required.
The starter also includes the pinned SDK's ESM bundle as `runtime.js`; keep it in
the ZIP and import it from `app.mjs`. Load `app.mjs` with `type="module"`, not a
classic `runtime.js` script tag. Do not include SDK source maps or npm package
metadata. Runtime injection by the upload pipeline is not assumed. Storage needs
no new manifest fields; see [the storage guide](storage.md).

```json
{
  "schemaVersion": 1,
  "name": "Consultation calculator",
  "entrypoint": "index.html"
}
```

## Manifest

- Exactly `manifest.json` at the ZIP root; at most 16 KiB, valid UTF-8 JSON.
- Required properties: `schemaVersion`, `name`, and `entrypoint`. Only `editor`
  may be added; unknown properties at either level are rejected.
- `schemaVersion`: integer literal `1`.
- `name`: nonblank after whitespace trimming, at most 80 Unicode characters.
- `entrypoint`: valid package path ending in lowercase `.html`, identifying a
  file that exists with exactly the same case. Nested entrypoints are allowed.
- `editor`: optional object containing only `entrypoint`, a valid package path to
  an existing lowercase `.html` file with matching case. It may be nested or use
  the same file as the main entrypoint. Omit `editor` when no config page is needed;
  `null` is also accepted and means no config page.
- No additional JSON value after the manifest. The manifest is not served.

### Optional config page

The extended manifest still uses **`schemaVersion: 1`**, not `2`. Existing
three-property manifests remain valid. For a separate settings screen:

```json
{
  "schemaVersion": 1,
  "name": "Consultation calculator",
  "entrypoint": "index.html",
  "editor": {
    "entrypoint": "settings/editor.html"
  }
}
```

Include `settings/editor.html` and its scripts/styles in the same ZIP. Paths are
relative to the package root, not to the main HTML file, and cannot be external
URLs or contain a query/fragment. These files share the normal archive limits.
See [the config-page guide](config-page.md) for the UI flow, relative imports,
storage example, and security restrictions. No manifest permissions are needed
for storage, and the config page is not a private file.

The local tools enforce this canonical form. They can be stricter than incidental
Go JSON-decoder behavior (for example, case-insensitive keys or replacement of
malformed Unicode); those decoder quirks are not an authoring contract.

## Files and paths

Allowed extensions, case sensitive:
`.html`, `.css`, `.js`, `.mjs`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.ico`,
`.woff`, `.woff2`. `manifest.json` is the only JSON-file exception.

No standalone SVG, JSON, source maps, TypeScript, Markdown, package files, or ZIPs
inside the ZIP. Embed static data in HTML/JS; use supported image formats.

Paths use only ASCII letters, numbers, `_`, `-`, `.`, and `/`, up to 240 characters.
No absolute paths, backslashes, empty segments, `.` or `..` segments, hidden
segments, or percent encoding. Paths are unique ignoring case; a file cannot also
be the parent of another file. Only regular files and directories are allowed:
no symlinks, device files, or encrypted entries. Use standard stored/deflated ZIPs.

## Limits

| Item                                          | Maximum                   |
| --------------------------------------------- | ------------------------- |
| Complete ZIP                                  | 10 MiB (10,485,760 bytes) |
| Total expanded files, including manifest      | 30 MiB (31,457,280 bytes) |
| Individual file                               | 10 MiB                    |
| Manifest                                      | 16 KiB (16,384 bytes)     |
| Entries, including explicit directory entries | 100                       |
| Path                                          | 240 ASCII characters      |

## Tool behavior

`package.mjs <directory> <output.zip>` checks the directory, builds an archive,
validates the resulting bytes, then writes a new file. It rejects unsupported or
hidden files rather than silently omitting them, except for `.DS_Store`.
These macOS metadata entries are automatically skipped at every depth and do not
count toward package limits. The original files are left untouched. Existing
ZIPs containing `.DS_Store` are still rejected by the validator and backend.

The output ZIP must be outside the input directory; existing outputs are never
overwritten. Empty directories are omitted from the ZIP, but the input tree is
conservatively limited to 100 entries including directories.

`validate.mjs <archive.zip>` checks ZIP metadata, paths, manifest, both entrypoints,
actual decompressed bytes and CRC checksums without extracting or executing files.
Both commands return a nonzero exit code on failure.

Neither tool checks JavaScript behavior, local resource references, accessibility,
or visual layout. These require source review and, when available, browser tests.
