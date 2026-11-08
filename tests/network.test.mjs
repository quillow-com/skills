import assert from 'node:assert/strict'
import test from 'node:test'

import { archive, baseFiles, manifest } from './fixtures.mjs'

import { validateArchive } from '../src/archive-contract.mjs'
import { allowedOrigins } from '../src/network.mjs'

test('network origins normalize without expanding permissions', () => {
  assert.deepEqual(
    allowedOrigins({
      allowedOrigins: [
        'HTTPS://API.Example.COM:00443',
        'https://api.example.com',
        'https://api.example.com:08443',
        'https://xn--e1afmkfd.xn--p1ai',
      ],
    }),
    [
      'https://api.example.com',
      'https://api.example.com:8443',
      'https://xn--e1afmkfd.xn--p1ai',
    ]
  )
  const origins = Array.from(
    { length: 16 },
    (_, i) => `https://api${i}.example.com`
  )
  assert.deepEqual(allowedOrigins({ allowedOrigins: origins }), origins)
  assert.throws(() =>
    allowedOrigins({ allowedOrigins: [...origins, origins[0]] })
  )
})

for (const network of [
  undefined,
  null,
  {},
  { allowedOrigins: null },
  { allowedOrigins: [] },
]) {
  test(`network disabled by default: ${JSON.stringify(network)}`, async () => {
    assert.deepEqual(allowedOrigins(network), [])
    const result = await validateArchive(
      archive(baseFiles(JSON.stringify({ ...manifest, network })))
    )
    assert.deepEqual(allowedOrigins(result.manifest.network), [])
  })
}

test('archive preserves normalized network in schema v1', async () => {
  const result = await validateArchive(
    archive(
      baseFiles(
        JSON.stringify({
          ...manifest,
          network: {
            allowedOrigins: [
              'HTTPS://API.EXAMPLE.COM:443',
              'https://api.example.com',
            ],
          },
        })
      )
    )
  )
  assert.equal(result.manifest.schemaVersion, 1)
  assert.deepEqual(result.manifest.network, {
    allowedOrigins: ['https://api.example.com'],
  })
})

for (const origin of [
  '',
  '*',
  'https:',
  'http://api.example.com',
  'wss://api.example.com',
  'https://*.example.com',
  'https://example.com/',
  'https://example.com/path',
  'https://example.com?x=1',
  'https://example.com#fragment',
  'https://user:pass@example.com',
  'https://example.com@evil.com',
  'https://localhost',
  'https://foo.localhost',
  'https://foo.local',
  'https://intranet',
  'https://127.0.0.1',
  'https://127.1',
  'https://2130706433',
  'https://0x7f000001',
  'https://0x7f.0.0.1',
  'https://[::1]',
  'https://[2001:db8::1]',
  'https://example.com.',
  'https://example..com',
  'https://-bad.example.com',
  'https://bad-.example.com',
  'https://bad_name.example.com',
  `https://${'a'.repeat(64)}.com`,
  `https://${'a.'.repeat(126)}com`,
  'https://пример.рф',
  'https://K.com',
  'https://ſ.com',
  'https://example.com:0',
  'https://example.com:65536',
  'https://example.com:',
  'https://example.com:*',
  'https://example.com:000443',
  'https://example.com:+443',
  'https://example.com:443:443',
  ' https://example.com',
  'https://example.com\n',
  'https://example.com\r\nX-Test: yes',
  'https://example.com; script-src *',
  'https://example.com https://evil.com',
  'https://example.com\\evil',
  'https://%65xample.com',
  'https://example.com%2f',
  "'self'",
  'https://example.com/../',
]) {
  test(`reject network origin: ${JSON.stringify(origin)}`, async () => {
    const network = { allowedOrigins: ['https://valid.example.com', origin] }
    assert.throws(() => allowedOrigins(network))
    await assert.rejects(
      validateArchive(
        archive(baseFiles(JSON.stringify({ ...manifest, network })))
      ),
      /network/
    )
  })
}

for (const network of [
  false,
  1,
  'https://example.com',
  [],
  { domains: [] },
  { allowedOrigins: 'https://example.com' },
  { allowedOrigins: [null] },
  { allowedOrigins: [1] },
  { allowedOrigins: [], proxy: true },
]) {
  test(`reject network shape: ${JSON.stringify(network)}`, async () => {
    await assert.rejects(
      validateArchive(
        archive(baseFiles(JSON.stringify({ ...manifest, network })))
      ),
      /network/
    )
  })
}
