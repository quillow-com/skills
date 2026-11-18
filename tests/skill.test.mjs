import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { configPageExample } from './fixtures.mjs'

const skill = new URL('../skills/quillow-custom-block/', import.meta.url)

test('skill instructions and guides do not teach opening settings through the SDK', async () => {
  const documents = [
    new URL('../README.md', import.meta.url),
    ...[
      'SKILL.md',
      'references/config-page.md',
      'references/runtime-and-layout.md',
      'references/storage.md',
    ].map((filename) => new URL(filename, skill)),
  ]

  for (const document of documents) {
    assert.doesNotMatch(
      await readFile(document, 'utf8'),
      /openEditor|editor\.open|EDITOR_UNAVAILABLE|openBlockEditor|open-the-editor-through-the-sdk/,
      document.pathname
    )
  }

  for (const filename of ['SKILL.md', 'references/config-page.md']) {
    assert.match(
      await readFile(new URL(filename, skill), 'utf8'),
      /Open settings only through Quillow's \*\*Custom Block settings\*\* gear/
    )
  }
})

test('config-page examples retain settings storage without an opening helper', async () => {
  const example = await configPageExample()

  assert.deepEqual(Object.keys(example).sort(), [
    'editorScript',
    'html',
    'manifest',
    'readerScript',
  ])
  assert.equal(example.manifest.editor.entrypoint, 'settings/editor.html')
  assert.match(example.editorScript, /widget\.storage\.set\(/)
  assert.match(example.readerScript, /widget\.storage\.get\(/)
})
