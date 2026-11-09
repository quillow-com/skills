import { chromium, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { env } from 'node:process'
import test from 'node:test'

import { configPageExample } from '../fixtures.mjs'

const sdkEntry = env.QUILLOW_SDK_TEST_ENTRY
const storageVersion = 1

const viewports = [
  { name: 'small', width: 156, height: 156, introVisible: false },
  { name: 'medium', width: 336, height: 156, introVisible: true },
  { name: 'large', width: 336, height: 336, introVisible: true },
]

async function createHost(t, renderWidget, extraFiles = {}) {
  const files = new Map()
  const types = {
    '.html': 'text/html',
    '.mjs': 'text/javascript',
    '.js': 'text/javascript',
    '.css': 'text/css',
  }

  for (const name of ['index.html', 'app.mjs', 'runtime.js', 'style.css']) {
    files.set(
      `/package/${name}`,
      await readFile(
        new URL(
          `../../skills/quillow-custom-block/templates/starter/${name}`,
          import.meta.url
        )
      )
    )
  }

  for (const [name, content] of Object.entries(extraFiles)) {
    files.set(`/package/${name}`, content)
  }

  if (sdkEntry) files.set('/package/runtime.js', await readFile(sdkEntry))

  let origin

  const server = createServer((request, response) => {
    if (request.url === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html' })
      response.end(
        `<iframe title="Widget" sandbox="allow-scripts allow-top-navigation-by-user-activation" referrerpolicy="no-referrer" src="${origin}/package/index.html" style="border:0;width:156px;height:156px"></iframe>`
      )

      return
    }

    if (request.url === '/contact') {
      response.writeHead(200, { 'Content-Type': 'text/html' })
      response.end('<h1>Contact destination</h1>')

      return
    }

    if (!files.has(request.url)) {
      response.writeHead(404)
      response.end()

      return
    }

    const prefix = `${origin}/package/`

    response.writeHead(200, {
      'Content-Type': types[path.extname(request.url)],
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': [
        'sandbox allow-scripts allow-top-navigation-by-user-activation',
        "default-src 'none'",
        `script-src 'unsafe-inline' ${prefix}`,
        `style-src 'unsafe-inline' ${prefix} https://fonts.googleapis.com`,
        `img-src data: ${prefix}`,
        `font-src ${prefix} https://fonts.gstatic.com`,
        "connect-src 'none'",
        "worker-src 'none'",
        "frame-src 'none'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        'frame-ancestors https: http://localhost:* http://127.0.0.1:*',
      ].join('; '),
    })
    response.end(files.get(request.url))
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  origin = `http://127.0.0.1:${server.address().port}`

  if (renderWidget) {
    files.set('/package/index.html', renderWidget(origin))
  }

  const browser = await chromium.launch()
  t.after(() => browser.close())

  return { origin, browser }
}

const storageCapabilities = [
  'storage.get',
  'storage.list',
  'storage.set',
  'storage.delete',
]

function storageEntry(key, value, revision = 'revision-1') {
  return {
    key,
    value,
    revision,
    createdAt: '2026-11-08T10:00:00Z',
    updatedAt: '2026-11-08T10:00:00Z',
  }
}

// Scripted responses exercise the published SDK through a real MessageChannel;
// this fixture does not implement or verify the production KV backend.
async function installStorageHost(
  page,
  {
    mode = 'editor',
    capabilities = storageCapabilities,
    editor,
    replies = [],
  } = {}
) {
  await page.evaluate(
    ({ mode, capabilities, editor, replies, storageVersion }) => {
      window.storageRequests = []
      const sessions = new Set()
      window.addEventListener('message', (event) => {
        const data = event.data
        if (
          event.source !== document.querySelector('iframe').contentWindow ||
          event.origin !== 'null' ||
          data?.protocol !== 'quillow:custom-block' ||
          data.version !== storageVersion ||
          data.type !== 'connect' ||
          sessions.has(data.connectionId)
        )
          return

        sessions.add(data.connectionId)
        const channel = new MessageChannel()
        const envelope = {
          protocol: 'quillow:custom-block',
          version: storageVersion,
          connectionId: data.connectionId,
        }
        channel.port1.addEventListener('message', ({ data: request }) => {
          if (request.type === 'disconnect') {
            channel.port1.close()
            return
          }
          if (request.type === 'ping') {
            channel.port1.postMessage({
              ...envelope,
              type: 'pong',
              requestId: request.requestId,
            })
            return
          }
          if (request.type !== 'request') return

          window.storageRequests.push({
            method: request.method,
            params: request.params,
          })
          const reply = replies.shift()
          if (!reply || reply.drop) return

          channel.port1.postMessage({
            ...envelope,
            type: 'response',
            requestId: request.requestId,
            ok: !reply.error,
            ...(reply.error
              ? { error: reply.error }
              : { result: reply.result }),
          })
        })
        channel.port1.start()
        event.source.postMessage(
          {
            ...envelope,
            type: 'connected',
            context: {
              blockId: 'block-1',
              versionId: 'version-1',
              mode,
              capabilities,
              ...(editor !== undefined ? { editor } : {}),
            },
          },
          '*',
          [channel.port2]
        )
      })
    },
    { mode, capabilities, editor, replies, storageVersion }
  )
}

test('starter works in the host sandbox/CSP at every Quillow size', async (t) => {
  const { origin, browser } = await createHost(t)
  const page = await browser.newPage()
  const errors = []
  const failed = []

  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text())
    }
  })
  page.on('requestfailed', (request) => failed.push(request.url()))
  await page.goto(origin)

  const frame = page.frameLocator('iframe')
  const action = frame.locator('#action')

  await action.waitFor()
  assert.equal(await action.getAttribute('aria-pressed'), 'false')
  await action.click()
  assert.equal(await action.getAttribute('aria-pressed'), 'true')
  assert.equal(await action.textContent(), 'Action complete')
  await action.focus()
  await page.keyboard.press('Enter')
  assert.equal(await action.getAttribute('aria-pressed'), 'false')
  await action.click()

  for (const viewport of viewports) {
    await page.locator('iframe').evaluate((element, size) => {
      element.style.width = `${size.width}px`
      element.style.height = `${size.height}px`
    }, viewport)

    assert.equal(
      await frame.locator('.block-intro').isVisible(),
      viewport.introVisible,
      `${viewport.name} intro visibility`
    )
    assert.equal(
      await frame.locator('body').evaluate(() => {
        return (
          document.documentElement.scrollWidth <= innerWidth &&
          document.documentElement.scrollHeight <= innerHeight
        )
      }),
      true,
      `${viewport.name} document overflow`
    )
    assert.equal(
      await frame.locator('body').evaluate(() => {
        return [...document.querySelectorAll('h1, h2, p, button')]
          .filter((element) => {
            const style = getComputedStyle(element)
            return style.display !== 'none' && style.visibility !== 'hidden'
          })
          .every((element) => {
            const rect = element.getBoundingClientRect()
            return (
              rect.left >= 0 &&
              rect.top >= 0 &&
              rect.right <= innerWidth &&
              rect.bottom <= innerHeight
            )
          })
      }),
      true,
      `${viewport.name} visible content bounds`
    )
    assert.equal(
      await action.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return rect.width >= 40 && rect.height >= 40
      }),
      true,
      `${viewport.name} action target`
    )
    assert.equal(
      await frame.locator('body').evaluate(() => {
        return [...document.querySelectorAll('h1, h2, p, button')]
          .filter((element) => getComputedStyle(element).display !== 'none')
          .every(
            (element) =>
              Number.parseFloat(getComputedStyle(element).fontSize) >= 12
          )
      }),
      true,
      `${viewport.name} text size`
    )
  }

  // Emulate the deployed parent bridge after exercising the no-context fallback.
  await page.evaluate(() => {
    window.sdkReady = false
    window.addEventListener('message', (event) => {
      if (
        event.source === document.querySelector('iframe').contentWindow &&
        event.data?.protocol === 'quillow:custom-block' &&
        event.data?.type === 'ready'
      )
        window.sdkReady = true
    })
    document.querySelector('iframe').contentWindow.postMessage(
      {
        protocol: 'quillow:custom-block',
        version: 1,
        type: 'hello',
      },
      '*'
    )
  })
  await page.waitForFunction(() => window.sdkReady)

  const context = {
    theme: {
      mode: 'dark',
      cornerStyle: 'Sharp',
      fontStylesheet: null,
      variables: {
        '--quillow-text-color': '#eeeeee',
        '--quillow-surface-color': '#111111',
        '--quillow-accent-color': '#ffff00',
        '--quillow-accent-text-color': '#111111',
        '--quillow-radius': '0px',
        '--quillow-typography': 'Arial, sans-serif',
      },
    },
    layout: { size: '1:1', width: 336, height: 336, viewport: 'desktop' },
    environment: 'editor',
  }
  const sendContext = async () => {
    await page.evaluate((context) => {
      document.querySelector('iframe').contentWindow.postMessage(
        {
          protocol: 'quillow:custom-block',
          version: 1,
          type: 'context',
          context,
        },
        '*'
      )
    }, context)
    await expect(frame.locator('html')).toHaveAttribute(
      'data-quillow-size',
      context.layout.size
    )
    await expect(frame.locator('html')).toHaveAttribute(
      'data-quillow-theme',
      context.theme.mode
    )
  }
  await sendContext()
  // Host composition wins even when the fallback media query would choose large.
  await expect(frame.locator('.block-intro')).toBeHidden()
  await expect(frame.locator('.block-description')).toBeHidden()
  await expect(frame.locator('html')).toHaveCSS(
    'background-color',
    'rgb(17, 17, 17)'
  )
  await expect(action).toHaveCSS('background-color', 'rgb(255, 255, 0)')
  await expect(action).toHaveCSS('color', 'rgb(17, 17, 17)')
  await expect(action).toHaveCSS('border-radius', '0px')
  await expect(frame.locator('html')).toHaveCSS(
    'font-family',
    'Arial, sans-serif'
  )

  for (const [index, viewport] of viewports.entries()) {
    await page.locator('iframe').evaluate((element, size) => {
      element.style.width = `${size.width}px`
      element.style.height = `${size.height}px`
    }, viewport)
    context.layout = {
      size: ['1:1', '2:1', '2:2'][index],
      width: viewport.width,
      height: viewport.height,
      viewport: 'mobile',
    }
    context.theme.mode = 'light'
    context.theme.variables['--quillow-text-color'] = '#111111'
    context.theme.variables['--quillow-surface-color'] = '#ffffff'
    await sendContext()
    await expect(frame.locator('.block-intro')).toBeVisible({
      visible: viewport.introVisible,
    })
    await expect(action).toHaveAttribute('aria-pressed', 'true')
    assert.equal(
      await frame.locator('body').evaluate(() =>
        [...document.querySelectorAll('h1, h2, p, button')]
          .filter((element) => element.checkVisibility())
          .every((element) => {
            const rect = element.getBoundingClientRect()
            return (
              rect.left >= 0 &&
              rect.top >= 0 &&
              rect.right <= innerWidth &&
              rect.bottom <= innerHeight
            )
          })
      ),
      true,
      `${viewport.name} host composition bounds`
    )
    await expect(frame.locator('html')).toHaveAttribute(
      'data-quillow-viewport',
      'mobile'
    )
  }

  // Deterministic font stylesheet delivery, without an external network dependency.
  await page.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({
      contentType: 'text/css',
      body: '/* Host font stylesheet fixture */',
      headers: { 'Access-Control-Allow-Origin': '*' },
    })
  )
  context.theme.fontStylesheet =
    'https://fonts.googleapis.com/css2?family=Roboto'
  await sendContext()
  await expect(frame.locator('link[href*="fonts.googleapis.com"]')).toHaveCount(
    1
  )
  context.theme.fontStylesheet =
    'https://fonts.googleapis.com/css2?family=Inter'
  context.theme.variables['--quillow-typography'] = 'Georgia, serif'
  await sendContext()
  await expect(frame.locator('link[href*="family=Inter"]')).toHaveCount(1)
  await expect(frame.locator('link[href*="fonts.googleapis.com"]')).toHaveCount(
    1
  )
  await expect(frame.locator('html')).toHaveCSS('font-family', 'Georgia, serif')
  context.theme.fontStylesheet = null
  await sendContext()
  await expect(frame.locator('link[href*="fonts.googleapis.com"]')).toHaveCount(
    0
  )
  await expect(action).toHaveAttribute('aria-pressed', 'true')

  assert.deepEqual(errors, [])
  assert.deepEqual(failed, [])
})

test('navigation follows user activation and popup restrictions', async (t) => {
  const { origin, browser } = await createHost(
    t,
    (origin) => `<!doctype html>
      <a id="ordinary" href="${origin}/contact">Inside iframe</a>
      <a id="top" href="${origin}/contact" target="_top">Main page</a>
      <button id="button" type="button">Main page</button>
      <a id="blank" href="${origin}/contact" target="_blank">New window</a>
      <button id="popup" type="button">New window</button>
      <script>
        document.querySelector('#button').addEventListener('click', () => {
          window.top.location.href = '${origin}/contact'
        })
        const popup = document.querySelector('#popup')
        popup.addEventListener('click', () => {
          popup.dataset.blocked = String(window.open('${origin}/contact') === null)
        })
      </script>`
  )
  const destination = `${origin}/contact`

  await t.test('ordinary link navigates only the iframe', async (t) => {
    const page = await browser.newPage()
    t.after(() => page.close())
    await page.goto(origin)
    const widget = page.frame({ url: `${origin}/package/index.html` })

    await Promise.all([
      widget.waitForURL(destination),
      widget.locator('#ordinary').click(),
    ])

    assert.equal(page.url(), `${origin}/`)
    assert.equal(widget.url(), destination)
    assert.equal(
      await widget.locator('h1').textContent(),
      'Contact destination'
    )
  })

  for (const [name, selector] of [
    ['_top link', '#top'],
    ['synchronous button handler', '#button'],
  ]) {
    await t.test(`${name} navigates the main page after a click`, async (t) => {
      const page = await browser.newPage()
      t.after(() => page.close())
      await page.goto(origin)

      await Promise.all([
        page.waitForURL(destination),
        page.frameLocator('iframe').locator(selector).click(),
      ])

      assert.equal(page.url(), destination)
      assert.equal(
        await page.locator('h1').textContent(),
        'Contact destination'
      )
      assert.equal(page.frames().length, 1)
    })
  }

  for (const [name, selector] of [
    ['_blank link', '#blank'],
    ['window.open', '#popup'],
  ]) {
    await t.test(`${name} cannot open a new window`, async (t) => {
      const page = await browser.newPage()
      t.after(() => page.close())
      await page.goto(origin)
      const control = page.frameLocator('iframe').locator(selector)

      await Promise.all([
        page.waitForEvent('console', {
          predicate: (message) =>
            message.type() === 'error' &&
            message.text().includes("'allow-popups'"),
          timeout: 5000,
        }),
        control.click(),
      ])

      if (selector === '#popup') {
        assert.equal(await control.getAttribute('data-blocked'), 'true')
      }
      assert.equal(page.context().pages().length, 1)
      assert.equal(page.url(), `${origin}/`)
      assert.equal(
        page
          .frames()
          .find((frame) => frame.parentFrame() === page.mainFrame())
          .url(),
        `${origin}/package/index.html`
      )
    })
  }
})

test('automatic top navigation is blocked without user activation', async (t) => {
  const { origin, browser } = await createHost(
    t,
    (origin) => `<!doctype html>
      <p id="result">Not attempted</p>
      <script>
        try {
          window.top.location.href = '${origin}/contact'
          document.querySelector('#result').textContent = 'Allowed'
        } catch (error) {
          document.querySelector('#result').textContent = error.name
        }
      </script>`
  )
  const page = await browser.newPage()
  await page.goto(origin)

  assert.equal(
    await page.frameLocator('iframe').locator('#result').textContent(),
    'SecurityError'
  )
  assert.equal(page.url(), `${origin}/`)
  assert.equal(
    page
      .frames()
      .find((frame) => frame.parentFrame() === page.mainFrame())
      .url(),
    `${origin}/package/index.html`
  )
})

test('local ESM storage supports CRUD, revisions, and pagination in the sandbox', async (t) => {
  const { origin, browser } = await createHost(t)
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.goto(origin)

  const created = storageEntry('settings', '')
  const saved = storageEntry(
    'settings',
    JSON.stringify({ title: 'Updated title' }),
    'revision-2'
  )
  await installStorageHost(page, {
    replies: [
      { result: null },
      { result: created },
      { result: saved },
      {
        error: {
          code: 'widget_storage_conflict',
          message: 'Read again before updating',
          details: { key: 'settings' },
        },
      },
      { result: { entries: [saved], nextCursor: 'opaque-cursor' } },
      {
        result: { entries: [storageEntry('other', 'true')], nextCursor: null },
      },
      { result: true },
      { result: null },
    ],
  })

  const frame = page.frame({ url: `${origin}/package/index.html` })
  const result = await frame.evaluate(async (parentOrigin) => {
    const { connect, Quillow, WidgetSDKError } = await import('./runtime.js')
    const widget = await connect({ parentOrigin })
    try {
      const missing = await widget.storage.get('settings')
      const created = await widget.storage.set('settings', '')
      const saved = await widget.storage.set(
        'settings',
        JSON.stringify({ title: 'Updated title' }),
        { expectedRevision: created.revision }
      )
      let conflict
      try {
        await widget.storage.set('settings', 'stale edit', {
          expectedRevision: created.revision,
        })
      } catch (error) {
        if (!(error instanceof WidgetSDKError)) throw error
        conflict = { code: error.code, details: error.details }
      }
      const first = await widget.storage.list({ limit: 1 })
      const next = await widget.storage.list({
        after: first.nextCursor,
        limit: 1,
      })
      const deleted = await widget.storage.delete('settings', {
        expectedRevision: saved.revision,
      })
      const afterDelete = await widget.storage.get('settings')
      return {
        missing,
        created,
        saved,
        conflict,
        first,
        next,
        deleted,
        afterDelete,
        blockId: widget.blockId,
        versionId: widget.versionId,
        mode: widget.mode,
        hasGlobal: 'Quillow' in window,
        hasThemeContext: Quillow.getContext() !== undefined,
      }
    } finally {
      widget.destroy()
    }
  }, origin)

  assert.equal(result.missing, null)
  assert.deepEqual(result.created, created)
  assert.deepEqual(result.saved, saved)
  assert.deepEqual(result.conflict, {
    code: 'widget_storage_conflict',
    details: { key: 'settings' },
  })
  assert.equal(result.next.nextCursor, null)
  assert.equal(result.deleted, true)
  assert.equal(result.afterDelete, null)
  assert.equal(result.blockId, 'block-1')
  assert.equal(result.versionId, 'version-1')
  assert.equal(result.mode, 'editor')
  assert.equal(result.hasGlobal, false)
  assert.equal(result.hasThemeContext, false)
  assert.deepEqual(await page.evaluate(() => window.storageRequests), [
    { method: 'storage.get', params: { key: 'settings' } },
    { method: 'storage.set', params: { key: 'settings', value: '' } },
    {
      method: 'storage.set',
      params: {
        key: 'settings',
        value: JSON.stringify({ title: 'Updated title' }),
        expectedRevision: 'revision-1',
      },
    },
    {
      method: 'storage.set',
      params: {
        key: 'settings',
        value: 'stale edit',
        expectedRevision: 'revision-1',
      },
    },
    { method: 'storage.list', params: { limit: 1 } },
    { method: 'storage.list', params: { limit: 1, after: 'opaque-cursor' } },
    {
      method: 'storage.delete',
      params: { key: 'settings', expectedRevision: 'revision-2' },
    },
    { method: 'storage.get', params: { key: 'settings' } },
  ])
  assert.deepEqual(errors, [])
})

test('bundled SDK rejects invalid storage values locally and preserves string contents', async (t) => {
  const { origin, browser } = await createHost(t)
  const page = await browser.newPage()
  await page.goto(origin)
  const saved = storageEntry('text', '  Привет 🙂\n{"title":"Text"}\t')
  await installStorageHost(page, { replies: [{ result: saved }] })
  const frame = page.frame({ url: `${origin}/package/index.html` })
  const result = await frame.evaluate(async (value) => {
    const { connect, WidgetSDKError } = await import('./runtime.js')
    const widget = await connect({ requestTimeout: 500 })
    try {
      const failures = []
      for (const invalid of [
        null,
        undefined,
        {},
        [],
        42,
        false,
        '\u0000',
        '\ud800',
        '\udfff',
      ]) {
        try {
          await widget.storage.set('text', invalid)
          failures.push(null)
        } catch (error) {
          if (!(error instanceof WidgetSDKError)) throw error
          failures.push({
            code: error.code,
            uncertain: error.mutationMayHaveSucceeded,
          })
        }
      }
      return { failures, saved: await widget.storage.set('text', value) }
    } finally {
      widget.destroy()
    }
  }, saved.value)
  assert.deepEqual(
    result.failures,
    Array(9).fill({ code: 'INVALID_ARGUMENT', uncertain: false })
  )
  assert.deepEqual(result.saved, saved)
  assert.deepEqual(await page.evaluate(() => window.storageRequests), [
    { method: 'storage.set', params: { key: 'text', value: saved.value } },
  ])
})

test('bundled SDK rejects non-string storage values returned by a host', async (t) => {
  const { origin, browser } = await createHost(t)
  const page = await browser.newPage()
  await page.goto(origin)
  await installStorageHost(page, {
    replies: [
      { result: storageEntry('settings', { title: 'Not a string' }) },
      {
        result: { entries: [storageEntry('settings', null)], nextCursor: null },
      },
    ],
  })
  const frame = page.frame({ url: `${origin}/package/index.html` })
  const failures = await frame.evaluate(async () => {
    const { connect, WidgetSDKError } = await import('./runtime.js')
    const widget = await connect()
    try {
      const failures = []
      for (const read of [
        () => widget.storage.get('settings'),
        () => widget.storage.list(),
      ]) {
        try {
          await read()
          failures.push(null)
        } catch (error) {
          if (!(error instanceof WidgetSDKError)) throw error
          failures.push({
            code: error.code,
            uncertain: error.mutationMayHaveSucceeded,
          })
        }
      }
      return failures
    } finally {
      widget.destroy()
    }
  })
  assert.deepEqual(
    failures,
    Array(2).fill({ code: 'PROTOCOL_ERROR', uncertain: false })
  )
  assert.deepEqual(await page.evaluate(() => window.storageRequests), [
    { method: 'storage.get', params: { key: 'settings' } },
    { method: 'storage.list', params: { limit: 50 } },
  ])
})

test('storage keeps public connections read-only and checks editor capabilities', async (t) => {
  const { origin, browser } = await createHost(t)

  for (const mode of ['public', 'editor']) {
    await t.test(mode, async (t) => {
      const page = await browser.newPage()
      t.after(() => page.close())
      await page.goto(origin)
      await installStorageHost(page, {
        mode,
        // A public connection must reject writes even with these capabilities.
        capabilities: mode === 'public' ? storageCapabilities : [],
        replies: [{ result: null }],
      })
      const frame = page.frame({ url: `${origin}/package/index.html` })
      const result = await frame.evaluate(async () => {
        const { connect } = await import('./runtime.js')
        const widget = await connect()
        const codes = []
        try {
          if (widget.mode === 'public') {
            await widget.storage.get('settings')
          } else {
            for (const read of [
              () => widget.storage.get('settings'),
              () => widget.storage.list(),
            ]) {
              try {
                await read()
              } catch (error) {
                codes.push(error.code)
              }
            }
          }
          for (const write of [
            () => widget.storage.set('settings', ''),
            () =>
              widget.storage.delete('settings', {
                expectedRevision: 'revision-1',
              }),
          ]) {
            try {
              await write()
            } catch (error) {
              codes.push(error.code)
            }
          }
          return codes
        } finally {
          widget.destroy()
        }
      })
      assert.deepEqual(
        result,
        Array(mode === 'public' ? 2 : 4).fill('PERMISSION_DENIED')
      )
      assert.deepEqual(
        await page.evaluate(() => window.storageRequests),
        mode === 'public'
          ? [{ method: 'storage.get', params: { key: 'settings' } }]
          : []
      )
    })
  }
})

test('a timed-out mutation is not replayed and can be reconciled by reading', async (t) => {
  const { origin, browser } = await createHost(t)
  const page = await browser.newPage()
  await page.goto(origin)
  const committed = storageEntry('settings', JSON.stringify({ title: 'Saved' }))
  await installStorageHost(page, {
    replies: [{ drop: true }, { result: committed }],
  })
  const frame = page.frame({ url: `${origin}/package/index.html` })
  const result = await frame.evaluate(async () => {
    const { connect, WidgetSDKError } = await import('./runtime.js')
    const widget = await connect({ requestTimeout: 100 })
    try {
      let failure
      try {
        await widget.storage.set('settings', JSON.stringify({ title: 'Saved' }))
      } catch (error) {
        if (!(error instanceof WidgetSDKError)) throw error
        failure = {
          code: error.code,
          uncertain: error.mutationMayHaveSucceeded,
        }
      }
      return { failure, entry: await widget.storage.get('settings') }
    } finally {
      widget.destroy()
    }
  })
  assert.deepEqual(result, {
    failure: { code: 'REQUEST_TIMEOUT', uncertain: true },
    entry: committed,
  })
  assert.deepEqual(await page.evaluate(() => window.storageRequests), [
    {
      method: 'storage.set',
      params: { key: 'settings', value: JSON.stringify({ title: 'Saved' }) },
    },
    { method: 'storage.get', params: { key: 'settings' } },
  ])
})

test('storage failures do not prevent local interaction or standalone previews', async (t) => {
  const { origin, browser } = await createHost(t)
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(origin)
  const frame = page.frame({ url: `${origin}/package/index.html` })
  const timeout = await frame.evaluate(async () => {
    const { connect } = await import('./runtime.js')
    try {
      await connect({ timeout: 100 })
    } catch (error) {
      return error.code
    }
  })
  assert.equal(timeout, 'CONNECT_TIMEOUT')
  await frame.locator('#action').click()
  await expect(frame.locator('#action')).toHaveAttribute('aria-pressed', 'true')

  await page.goto(`${origin}/package/index.html`)
  const unavailable = await page.evaluate(async () => {
    const { connect } = await import('./runtime.js')
    try {
      await connect()
    } catch (error) {
      return error.code
    }
  })
  assert.equal(unavailable, 'HOST_UNAVAILABLE')
  await page.locator('#action').click()
  await expect(page.locator('#action')).toHaveAttribute('aria-pressed', 'true')
  assert.deepEqual(errors, [])
})

test('documented editor opener handles legacy runtimes and optional v1 UI support', async (t) => {
  const example = await configPageExample()
  const { origin, browser } = await createHost(t, undefined, {
    'open-editor.mjs': example.openerScript,
  })

  async function run(t, options = {}, action = {}) {
    const page = await browser.newPage()
    const errors = []
    t.after(() => page.close())
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(origin)
    await installStorageHost(page, {
      capabilities: ['editor.open'],
      editor: { available: true },
      ...options,
    })
    const frame = page.frame({ url: `${origin}/package/index.html` })
    const result = await frame.evaluate(
      async ({ legacy, destroy, repeat = 1 }) => {
        const { connect } = await import('./runtime.js')
        const { openBlockEditor } = await import('./open-editor.mjs')
        const widget = await connect({ timeout: 500, requestTimeout: 100 })
        try {
          const supported = typeof widget.openEditor === 'function'
          if (destroy) widget.destroy()
          const target = legacy ? { ...widget, openEditor: undefined } : widget
          const messages = []
          for (let i = 0; i < repeat; i++) {
            messages.push(await openBlockEditor(target))
          }
          return { supported, messages }
        } finally {
          widget.destroy()
        }
      },
      action
    )
    assert.deepEqual(errors, [])
    return {
      ...result,
      requests: await page.evaluate(() => window.storageRequests),
    }
  }

  await t.test(
    'a runtime without the method falls back to the host gear',
    async (t) => {
      const result = await run(t, {}, { legacy: true })
      assert.deepEqual(result.messages, [
        'Use the Custom Block settings gear in Quillow; this SDK cannot open it programmatically.',
      ])
      assert.deepEqual(result.requests, [])
    }
  )

  await t.test(
    'public mode never attempts opening, even with a claimed capability',
    async (t) => {
      const result = await run(t, { mode: 'public' })
      assert.deepEqual(result.messages, [
        'Block settings can only be opened in the Quillow editor.',
      ])
      assert.deepEqual(result.requests, [])
    }
  )

  const scenarios = [
    {
      name: 'accepted opening and repeated calls use empty parameters',
      options: { replies: [{ result: true }, { result: true }] },
      action: { repeat: 2 },
      messages: ['Editor opening accepted.', 'Editor opening accepted.'],
      requests: 2,
    },
    {
      name: 'an explicitly absent screen is distinct from missing permission',
      options: { capabilities: [], editor: { available: false } },
      messages: ['This block has no available editor screen.'],
      requests: 0,
    },
    {
      name: 'an available screen without permission does not send a request',
      options: { capabilities: [] },
      messages: ['This host has not permitted opening the block editor.'],
      requests: 0,
    },
    {
      name: 'legacy host metadata does not imply an absent manifest editor',
      options: { capabilities: [], editor: undefined },
      messages: ['This host has not permitted opening the block editor.'],
      requests: 0,
    },
    {
      name: 'a definite host rejection reports the missing editor',
      options: {
        replies: [
          { error: { code: 'EDITOR_UNAVAILABLE', message: 'Unavailable' } },
        ],
      },
      messages: ['This block has no available editor screen.'],
      requests: 1,
    },
    {
      name: 'a host permission rejection is not reported as a missing screen',
      options: {
        replies: [
          { error: { code: 'PERMISSION_DENIED', message: 'Not permitted' } },
        ],
      },
      messages: ['This host has not permitted opening the block editor.'],
      requests: 1,
    },
    {
      name: 'a timeout is not retried or described as confirmed failure',
      options: { replies: [{ drop: true }] },
      messages: [
        'The editor may have opened. Check Quillow before trying again.',
      ],
      requests: 1,
    },
    {
      name: 'an invalid confirmation is not accepted as success',
      options: { replies: [{ result: false }] },
      messages: ['Unable to open the block editor (PROTOCOL_ERROR).'],
      requests: 1,
    },
    {
      name: 'a destroyed connection is not silently reused',
      action: { destroy: true },
      messages: ['Unable to open the block editor (DESTROYED).'],
      requests: 0,
    },
  ]

  for (const scenario of scenarios) {
    await t.test(scenario.name, async (t) => {
      const result = await run(t, scenario.options, scenario.action)
      assert.equal(
        result.supported,
        true,
        'The bundled SDK must implement openEditor()'
      )
      assert.deepEqual(result.messages, scenario.messages)
      assert.deepEqual(
        result.requests,
        Array.from({ length: scenario.requests }, () => ({
          method: 'editor.open',
          params: {},
        }))
      )
    })
  }
})

test('documented config-page examples work with the sandboxed SDK', async (t) => {
  const example = await configPageExample()
  const { origin, browser } = await createHost(t, undefined, {
    'settings/editor.html': example.html,
    'settings/editor.mjs': example.editorScript,
    'reader.html': `<!doctype html><h1 id="widget-title">Hello</h1>
      <p id="settings-status" role="status"></p>
      <script type="module" src="./reader.mjs"></script>`,
    'reader.mjs': example.readerScript,
  })
  const created = storageEntry(
    'settings',
    JSON.stringify({ title: 'First title' })
  )
  const updated = storageEntry(
    'settings',
    JSON.stringify({ title: 'Updated title' }),
    'revision-2'
  )

  async function open(t, options, entrypoint = 'settings/editor.html') {
    const page = await browser.newPage()
    const errors = []
    t.after(() => page.close())
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    await page.goto(origin)
    await installStorageHost(page, options)
    await page.locator('iframe').evaluate((iframe, url) => {
      iframe.style.width = '600px'
      iframe.style.height = '500px'
      iframe.src = url
    }, `${origin}/package/${entrypoint}`)
    return { page, frame: page.frameLocator('iframe'), errors }
  }

  await t.test(
    'create, update, and reopen use the saved revision',
    async (t) => {
      const { page, frame, errors } = await open(t, {
        replies: [
          { result: null },
          { result: created },
          { result: updated },
          { result: updated },
        ],
      })
      await expect(frame.locator('#save')).toBeEnabled()
      assert.deepEqual(await page.evaluate(() => window.storageRequests), [
        { method: 'storage.get', params: { key: 'settings' } },
      ])

      for (const title of ['First title', 'Updated title']) {
        await frame.locator('#title').fill(title)
        await frame.locator('#save').click()
        await expect(frame.locator('#status')).toHaveText('Saved.')
      }
      assert.deepEqual(await page.evaluate(() => window.storageRequests), [
        { method: 'storage.get', params: { key: 'settings' } },
        {
          method: 'storage.set',
          params: { key: 'settings', value: created.value },
        },
        {
          method: 'storage.set',
          params: {
            key: 'settings',
            value: updated.value,
            expectedRevision: created.revision,
          },
        },
      ])

      await page.locator('iframe').evaluate((iframe) => {
        iframe.src = iframe.src
      })
      await page.waitForFunction(() => window.storageRequests.length === 4)
      await expect(frame.locator('#title')).toHaveValue('Updated title')
      await expect(frame.locator('#status')).toHaveText('Ready to edit.')
      assert.deepEqual(errors, [])
    }
  )

  await t.test(
    'main widget reads settings without writing in public mode',
    async (t) => {
      const { page, frame, errors } = await open(
        t,
        {
          mode: 'public',
          capabilities: ['storage.get'],
          replies: [{ result: updated }],
        },
        'reader.html'
      )
      await expect(frame.locator('#widget-title')).toHaveText('Updated title')
      assert.deepEqual(await page.evaluate(() => window.storageRequests), [
        { method: 'storage.get', params: { key: 'settings' } },
      ])
      assert.deepEqual(errors, [])
    }
  )

  for (const [mode, capabilities, status] of [
    ['public', storageCapabilities, 'Settings are read-only.'],
    ['editor', ['storage.get'], 'Settings are read-only.'],
    ['editor', [], 'Saved settings are unavailable.'],
  ]) {
    await t.test(
      `config permissions: ${mode}, ${capabilities.join(',')}`,
      async (t) => {
        const { page, frame, errors } = await open(t, {
          mode,
          capabilities,
          replies: [{ result: created }],
        })
        await expect(frame.locator('#status')).toHaveText(status)
        await expect(frame.locator('#save')).toBeDisabled()
        assert.deepEqual(
          await page.evaluate(() => window.storageRequests),
          capabilities.includes('storage.get')
            ? [{ method: 'storage.get', params: { key: 'settings' } }]
            : []
        )
        assert.deepEqual(errors, [])
      }
    )
  }

  await t.test(
    'conflicts preserve drafts and stop further saves',
    async (t) => {
      const { page, frame, errors } = await open(t, {
        replies: [
          { result: created },
          {
            error: {
              code: 'widget_storage_conflict',
              message: 'Settings changed',
            },
          },
        ],
      })
      await expect(frame.locator('#save')).toBeEnabled()
      await frame.locator('#title').fill('My unsaved draft')
      await frame.locator('#save').click()
      await expect(frame.locator('#status')).toContainText(
        'widget_storage_conflict'
      )
      await expect(frame.locator('#save')).toBeDisabled()
      await expect(frame.locator('#title')).toHaveValue('My unsaved draft')
      await expect(frame.locator('#title')).toBeEnabled()
      // Even a synthetic click must not resend the mutation with a stale revision.
      await frame.locator('#save').dispatchEvent('click')
      assert.equal(await page.evaluate(() => window.storageRequests.length), 2)
      assert.deepEqual(errors, [])
    }
  )
})
