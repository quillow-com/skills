# Direct external API requests

Widgets can opt into external APIs using the existing manifest v1. Requests go
directly from the visitor's iframe to the API, never through a Quillow proxy or
SDK bridge. Confirm that the API supports browser CORS before choosing it.

```json
{
  "schemaVersion": 1,
  "name": "Weather",
  "entrypoint": "index.html",
  "network": {
    "allowedOrigins": ["https://api.open-meteo.com"]
  }
}
```

## Origin rules

- At most 16 entries, each at most 300 ASCII characters. The limit applies before
  deduplication. Use only the origins needed by the requested functionality.
- Exact HTTPS DNS origins, with an optional port 1–65535 (1–5 decimal digits). Subdomains and
  other ports are separate origins: `https://api.example.com` does not allow
  `https://sub.api.example.com` or `https://api.example.com:8443`.
- No wildcards, IP addresses (including numeric/hex variants), single-label hosts,
  localhost, `.localhost`/`.local` hosts, credentials, paths (even a final `/`),
  query, fragment, whitespace, or trailing DNS dot. Use ASCII Punycode for IDNs.
  DNS labels are 1–63 characters, hostnames at most 253; the final label starts
  with a letter.
- Scheme/host are lowercased, default port `443` is removed, other ports lose
  leading zeros, and duplicates are removed.
- Omitted/null `network`, an omitted/null list, or `allowedOrigins: []` keeps all
  connections denied. Do not add a generic `permissions` or proxy property.

The backend validates and normalizes the manifest into an immutable version
descriptor. The hosting Worker revalidates this descriptor and emits CSP
`connect-src` for that version. The main widget, config page, and preview share
that version's list. Other permissions do not change: API access does **not**
enable remote scripts, images, fonts, nested frames, or workers. Keep all widget
assets local and package the SDK normally. Storage needs no network permission.

## Fetch and CORS

```js
async function loadWeather(latitude, longitude) {
  const url = new URL('https://api.open-meteo.com/v1/forecast')
  url.search = new URLSearchParams({
    latitude,
    longitude,
    current: 'temperature_2m',
  })
  const response = await fetch(url, {
    credentials: 'omit',
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) throw new Error(`Weather API returned ${response.status}`)
  return response.json()
}
```

Call this from guarded async UI code; show loading, empty, and error states. Avoid
automatic repeated requests or retries of writes. Do not pretend failed requests
returned real data.

CSP does not override CORS. The sandbox has an opaque origin (`Origin: null`), so
public APIs typically need `Access-Control-Allow-Origin: *` and noncredentialed
requests. Non-simple requests also need a successful preflight. `no-cors` returns
an unreadable opaque response, not a workaround. If an API cannot support this,
explain the limitation or choose another API with the user; do not add a proxy.
All redirect destinations must be allowed too. HTTPS origin entries do not
authorize WebSocket `wss:` URLs; do not declare `wss:` entries.

## Security and verification

The allowlist controls connection destinations, not HTTP methods, payloads, or
what data a widget sends to an allowed API. Never put secret API keys in package
files, the manifest, or shared block storage. A domain can resolve to private
addresses; this is not complete local-network isolation. CSP `connect-src` is not
a general navigation firewall. The Worker does not intercept or rate-limit API
requests.

For browser checks, replace only the runtime guide's `connect-src 'none'` with the
normalized list. Do not relax other CSP/sandbox permissions. Test an allowed
fetch, a denied origin (including subdomain/port mismatches), CORS failure, timeout,
and API errors. Confirm no requests reach denied endpoints and remote scripts or
images remain blocked. Keep the no-network starter unchanged when no API is needed.
