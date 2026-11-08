import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'

import { configPageExample } from './fixtures.mjs'

import { validateArchive } from '../src/archive-contract.mjs'
import { packageDirectory } from '../src/package-core.mjs'

const run = promisify(execFile)
const skill = new URL('../skills/quillow-custom-block/', import.meta.url)

test('starter ships an SSR-safe local ESM SDK with storage exports', async () => {
  const runtime = new URL('templates/starter/runtime.js', skill)
  const { connect, Quillow, WidgetSDKError } = await import(runtime.href)

  assert.equal(typeof connect, 'function')
  assert.equal(typeof WidgetSDKError, 'function')
  assert.equal(Quillow.getContext(), undefined)
  await assert.rejects(connect(), (error) => {
    return error instanceof WidgetSDKError && error.code === 'HOST_UNAVAILABLE'
  })
  assert.doesNotMatch(await readFile(runtime, 'utf8'), /sourceMappingURL=/)
})

async function workspace(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'quillow-skills-'))
  t.after(() => rm(root, { recursive: true, force: true }))

  await cp(new URL('templates/starter/', skill), path.join(root, 'block'), {
    recursive: true,
  })

  return root
}

async function addConfigPage(root) {
  const { manifest, html, editorScript } = await configPageExample()
  const block = path.join(root, 'block')

  await writeFile(path.join(block, 'manifest.json'), JSON.stringify(manifest))
  await mkdir(path.join(block, 'settings'))
  await writeFile(path.join(block, 'settings/editor.html'), html)
  await writeFile(path.join(block, 'settings/editor.mjs'), editorScript)

  return manifest
}

test('package starter, preserve root layout, and refuse overwrite', async (t) => {
  const root = await workspace(t)
  const output = path.join(root, 'widget.zip')
  const result = await packageDirectory(path.join(root, 'block'), output)

  assert.equal(result.entries, 5)
  assert.deepEqual(
    (await validateArchive(await readFile(output))).files.sort(),
    ['app.mjs', 'index.html', 'runtime.js', 'style.css']
  )
  const original = await readFile(output)

  await assert.rejects(
    packageDirectory(path.join(root, 'block'), output),
    /EEXIST/
  )
  assert.deepEqual(await readFile(output), original)
})

test('package the documented config page with nested local resources', async (t) => {
  const root = await workspace(t)
  const manifest = await addConfigPage(root)
  const output = path.join(root, 'widget.zip')

  await packageDirectory(path.join(root, 'block'), output)

  const result = await validateArchive(await readFile(output))

  assert.deepEqual(result.manifest, manifest)
  assert.deepEqual(result.files.sort(), [
    'app.mjs',
    'index.html',
    'runtime.js',
    'settings/editor.html',
    'settings/editor.mjs',
    'style.css',
  ])
})

for (const entrypoint of ['settings/missing.html', 'Settings/editor.html']) {
  test(`invalid editor does not create an output: ${entrypoint}`, async (t) => {
    const root = await workspace(t)
    const manifest = await addConfigPage(root)
    const output = path.join(root, 'widget.zip')

    manifest.editor.entrypoint = entrypoint
    await writeFile(
      path.join(root, 'block', 'manifest.json'),
      JSON.stringify(manifest)
    )
    await assert.rejects(
      packageDirectory(path.join(root, 'block'), output),
      /editor entrypoint does not exist/
    )
    await assert.rejects(readFile(output), /ENOENT/)
  })
}

test('skip .DS_Store at every depth without deleting or counting it', async (t) => {
  const root = await workspace(t)
  const block = path.join(root, 'block')
  const nested = path.join(block, 'assets', 'images')
  const output = path.join(root, 'widget.zip')

  await mkdir(nested, { recursive: true })

  const metadata = [block, path.join(block, 'assets'), nested].map(
    (directory) => path.join(directory, '.DS_Store')
  )

  for (const filename of metadata) {
    await writeFile(filename, 'Finder metadata')
  }

  // Five starter files + two directories + 93 assets = exactly 100 entries.
  for (let i = 0; i < 93; i++) {
    await writeFile(path.join(nested, `asset${i}.js`), 'export default 1')
  }

  await packageDirectory(block, output)

  const result = await validateArchive(await readFile(output))

  assert.equal(result.entries, 98)
  assert.equal(
    result.files.some((name) => name.includes('.DS_Store')),
    false
  )

  for (const filename of metadata) {
    assert.equal(await readFile(filename, 'utf8'), 'Finder metadata')
  }
})

test('reject self-inclusion, hidden files, and symlinks', async (t) => {
  const root = await workspace(t)
  const block = path.join(root, 'block')
  const output = path.join(root, 'widget.zip')
  await assert.rejects(
    packageDirectory(block, path.join(block, 'widget.zip')),
    /outside/
  )
  await writeFile(path.join(block, '.hidden.js'), 'junk')
  await assert.rejects(packageDirectory(block, output), /invalid package path/)

  await rm(path.join(block, '.hidden.js'))
  await symlink(path.join(block, 'app.mjs'), path.join(block, 'link.js'))
  await assert.rejects(packageDirectory(block, output), /regular files/)
  await assert.rejects(readFile(output), /ENOENT/)
})

test('invalid manifest does not create an output', async (t) => {
  const root = await workspace(t)
  await writeFile(path.join(root, 'block', 'manifest.json'), '{}')
  await assert.rejects(
    packageDirectory(path.join(root, 'block'), path.join(root, 'widget.zip')),
    /manifest/
  )
  await assert.rejects(readFile(path.join(root, 'widget.zip')), /ENOENT/)
})

for (const withEditor of [false, true]) {
  test(`installed standalone bundles run without node_modules (${withEditor ? 'with' : 'without'} config page) and handle CLI errors`, async (t) => {
    const root = await workspace(t)
    const installed = path.join(root, 'installed skill')

    if (withEditor) await addConfigPage(root)

    await cp(skill, installed, { recursive: true })

    const pack = path.join(installed, 'scripts', 'package.mjs')
    const validate = path.join(installed, 'scripts', 'validate.mjs')

    const result = await run(
      process.execPath,
      [pack, './block', './output.zip'],
      { cwd: root }
    )
    assert.match(result.stdout, /Created and validated/)
    assert.match(
      (await run(process.execPath, [validate, './output.zip'], { cwd: root }))
        .stdout,
      /Valid package/
    )
    await assert.rejects(
      run(process.execPath, [validate], { cwd: root }),
      (error) => error.code === 1 && /Usage/.test(error.stderr)
    )
    await writeFile(path.join(root, 'bad.zip'), 'bad')
    await assert.rejects(
      run(process.execPath, [validate, './bad.zip'], { cwd: root }),
      (error) => error.code === 1 && /Validation failed/.test(error.stderr)
    )
  })
}
