import assert from 'node:assert/strict'
import test from 'node:test'

import { archive, baseFiles, manifest } from './fixtures.mjs'

import { limits, validateArchive } from '../src/archive-contract.mjs'

test('valid package, nested entrypoint, and Unicode name', async () => {
  const result = await validateArchive(
    archive([
      ...baseFiles(
        JSON.stringify({
          ...manifest,
          name: '🧮'.repeat(80),
          entrypoint: 'pages/main.html',
        })
      ),
      { name: 'pages/', mode: 0o040755 },
      { name: 'pages/main.html', data: '<h1>Nested</h1>', store: true },
    ])
  )
  assert.equal(result.entries, 4)
  assert.equal(result.manifest.entrypoint, 'pages/main.html')
})

for (const editor of [
  undefined,
  null,
  { entrypoint: 'editor.html' },
  { entrypoint: 'settings/editor.html' },
  { entrypoint: 'index.html' },
]) {
  test(`valid optional editor: ${JSON.stringify(editor)}`, async () => {
    const result = await validateArchive(
      archive([
        ...baseFiles(JSON.stringify({ ...manifest, editor })),
        { name: 'editor.html', data: '<h1>Settings</h1>' },
        { name: 'settings/', mode: 0o040755 },
        { name: 'settings/editor.html', data: '<h1>Nested settings</h1>' },
      ])
    )
    assert.deepEqual(result.manifest.editor, editor)
  })
}

for (const editor of [
  false,
  true,
  1,
  'editor.html',
  [],
  {},
  { entrypoint: null },
  { entrypoint: 1 },
  { entrypoint: '' },
  { entrypoint: 'missing.html' },
  { entrypoint: 'Editor.html' },
  { entrypoint: 'directory.html' },
  { entrypoint: 'app.js' },
  { entrypoint: 'editor.HTML' },
  { entrypoint: '../editor.html' },
  { entrypoint: '/editor.html' },
  { entrypoint: 'settings\\editor.html' },
  { entrypoint: 'https://example.com/editor.html' },
  { entrypoint: 'editor.html?mode=editor' },
  { entrypoint: 'editor.html#settings' },
  { entrypoint: '%2e%2e/editor.html' },
  { entrypoint: 'editor.html', permissions: ['storage'] },
  { entrypoint: 'editor.html', Entrypoint: 'editor.html' },
  { Entrypoint: 'editor.html' },
]) {
  test(`reject editor: ${JSON.stringify(editor)}`, async () => {
    await assert.rejects(
      validateArchive(
        archive([
          ...baseFiles(JSON.stringify({ ...manifest, editor })),
          { name: 'editor.html', data: '<h1>Settings</h1>' },
          { name: 'directory.html/', mode: 0o040755 },
          { name: 'app.js', data: 'export {}' },
        ])
      ),
      /editor|package path/
    )
  })
}

for (const name of [
  '../x.js',
  '/x.js',
  'assets\\x.js',
  'x.zip',
  'x.svg',
  'x.json',
  'a/../x.js',
  'a//x.js',
  '.hidden.js',
  '.DS_Store',
  'assets/.DS_Store',
  'x%2f.js',
  'INDEX.HTML',
  'assets/app.js/x.js',
  'assets/./x.js',
  'assets/.secret/x.js',
  `${'a'.repeat(238)}.js`,
  'café.js',
  '\ufeffextra.js',
]) {
  test(`reject path/type: ${name}`, async () => {
    await assert.rejects(
      validateArchive(
        archive([
          ...baseFiles(),
          { name: 'assets/app.js', data: 'ok' },
          { name, data: 'bad' },
        ])
      ),
      /invalid|unsupported|duplicate|collision/
    )
  })
}

for (const value of [
  'null',
  '{}',
  '[]',
  '{',
  JSON.stringify({ ...manifest, schemaVersion: 2 }),
  JSON.stringify({ ...manifest, entrypoint: 'missing.html' }),
  JSON.stringify({ ...manifest, entrypoint: 'INDEX.html' }),
  JSON.stringify({ ...manifest, entrypoint: 'app.js' }),
  JSON.stringify({ ...manifest, name: '' }),
  JSON.stringify({ ...manifest, name: ' \n\t' }),
  JSON.stringify({ ...manifest, name: '\u0085' }),
  JSON.stringify({ ...manifest, name: '🧮'.repeat(81) }),
  JSON.stringify({ ...manifest, permissions: ['network'] }),
  JSON.stringify(manifest) + '{}',
  JSON.stringify(manifest).replace(':1,', ':1.0,'),
  JSON.stringify(manifest).replace(':1,', ':1e0,'),
  JSON.stringify({ ...manifest, name: '\ud800' }),
]) {
  test(`reject manifest: ${value.slice(0, 100)}`, async () => {
    await assert.rejects(validateArchive(archive(baseFiles(value))))
  })
}

test('missing root manifest and wrapped project', async () => {
  await assert.rejects(
    validateArchive(
      archive(
        baseFiles().map((file) => ({ ...file, name: `project/${file.name}` }))
      )
    )
  )
  await assert.rejects(
    validateArchive(archive([{ name: 'index.html', data: 'ok' }])),
    /missing/
  )
})

test('duplicates, including directory/file collision ignoring case', async () => {
  for (const files of [
    [{ name: 'app.js' }, { name: 'APP.js' }],
    [
      { name: 'assets/', mode: 0o040755 },
      { name: 'ASSETS', mode: 0o040755 },
    ],
    [{ name: 'app.js' }, { name: 'APP.js/child.js' }],
  ]) {
    await assert.rejects(
      validateArchive(archive([...baseFiles(), ...files])),
      /duplicate|collision/
    )
  }
})

test('symlinks, special files, encryption, corrupt checksums', async () => {
  for (const mode of [0o120777, 0o020600, 0o010600, 0o140600]) {
    await assert.rejects(
      validateArchive(
        archive([...baseFiles(), { name: 'link.js', mode, data: '../secret' }])
      ),
      /regular files/
    )
  }
  await assert.rejects(
    validateArchive(archive([...baseFiles(), { name: 'app.js', flags: 1 }])),
    /encrypted/
  )
  await assert.rejects(
    validateArchive(
      archive([...baseFiles(), { name: 'app.js', data: 'ok', crc: 1 }])
    ),
    /CRC/
  )
  await assert.rejects(validateArchive(Buffer.from('not a zip')))
  await assert.rejects(validateArchive(archive(baseFiles()).subarray(0, -8)))
})

test('declared and actual expansion sizes are bounded', async () => {
  await assert.rejects(
    validateArchive(
      archive([
        ...baseFiles(),
        { name: 'large.js', data: 'x', size: limits.file + 1 },
      ])
    ),
    /size limit/
  )
  await assert.rejects(
    validateArchive(
      archive([
        ...baseFiles(),
        { name: 'lying.js', data: 'x'.repeat(1 << 20), size: 1 },
      ])
    ),
    /size|bytes/
  )
  await assert.rejects(
    validateArchive(archive(baseFiles(' '.repeat(limits.manifest + 1)))),
    /size limit/
  )
  const large = Buffer.alloc(limits.file, 120)
  await assert.rejects(
    validateArchive(
      archive([
        ...baseFiles(),
        ...Array.from({ length: 3 }, (_, i) => ({
          name: `asset${i}.js`,
          data: large,
        })),
      ])
    ),
    /size limit/
  )
})

test('entry count includes directories and exact limit is accepted', async () => {
  const files = [
    ...baseFiles(),
    ...Array.from({ length: 98 }, (_, i) => ({
      name: `d${i}/`,
      mode: 0o040755,
    })),
  ]
  assert.equal((await validateArchive(archive(files))).entries, 100)
  await assert.rejects(
    validateArchive(archive([...files, { name: 'extra.js' }])),
    /100 entries/
  )
  await assert.rejects(validateArchive(archive([])), /1–100/)
})

test('ZIP byte limit is enforced before parsing', async () => {
  await assert.rejects(
    validateArchive(Buffer.alloc(limits.zip + 1)),
    /ZIP size/
  )
  await assert.rejects(validateArchive(Buffer.alloc(0)), /ZIP size/)
})
