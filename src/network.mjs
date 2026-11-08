// Keep aligned with widget_package/network.go and widget-host/src/network.js.
export function allowedOrigins(network) {
  const invalid = () => {
    throw new Error(
      'manifest.json: network.allowedOrigins must contain at most 16 exact HTTPS DNS origins'
    )
  }
  if (network == null) return []
  if (
    typeof network !== 'object' ||
    Array.isArray(network) ||
    Object.keys(network).some((key) => key !== 'allowedOrigins')
  )
    invalid()
  const origins = network.allowedOrigins ?? []
  if (!Array.isArray(origins) || origins.length > 16) invalid()
  const result = new Set()
  for (const origin of origins) {
    if (typeof origin !== 'string' || origin.length > 300) invalid()
    const match = /^https:\/\/([a-z0-9.-]+)(?::([0-9]{1,5}))?$/i.exec(origin)
    if (!match || match[0] !== origin) invalid()
    const host = match[1].toLowerCase()
    const labels = host.split('.')
    if (
      host.length > 253 ||
      labels.length < 2 ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      labels.some(
        (label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)
      ) ||
      !/^[a-z]/.test(labels.at(-1))
    )
      invalid()
    const port = match[2] === undefined ? 443 : Number(match[2])
    if (port < 1 || port > 65535) invalid()
    result.add(`https://${host}${port === 443 ? '' : `:${port}`}`)
  }
  return [...result]
}
