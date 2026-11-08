import yauzl from 'yauzl'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { crc32 } from 'node:zlib'

export const limits = Object.freeze({
  zip: 10 << 20,
  expanded: 30 << 20,
  file: 10 << 20,
  manifest: 16 << 10,
  entries: 100,
})

const extensions = new Set([
  '.html',
  '.css',
  '.js',
  '.mjs',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.ico',
  '.woff',
  '.woff2',
])

export function assertPath(name) {
  if (
    !name ||
    name.length > 240 ||
    !/^[A-Za-z0-9_./-]+$/.test(name) ||
    name.startsWith('/') ||
    name.split('/').some((part) => !part || part.startsWith('.'))
  ) {
    throw new Error(`${name}: invalid package path`)
  }
}

export function assertFile(name) {
  assertPath(name)

  if (name !== 'manifest.json' && !extensions.has(path.posix.extname(name))) {
    throw new Error(`${name}: unsupported file type`)
  }
}

export async function readBounded(stream, limit, label) {
  const chunks = []
  let size = 0

  for await (const chunk of stream) {
    size += chunk.length

    if (size > limit) {
      throw new Error(`${label}: size limit exceeded (${limit} bytes)`)
    }

    chunks.push(chunk)
  }

  return Buffer.concat(chunks, size)
}

export function readFileBounded(filename, limit) {
  return readBounded(createReadStream(filename), limit, filename)
}

function parseManifest(data) {
  let manifest

  try {
    const text = new TextDecoder('utf-8', {
      fatal: true,
      ignoreBOM: true,
    }).decode(data)

    manifest = JSON.parse(text, (key, value, context) => {
      if (key === 'schemaVersion' && context.source !== '1') {
        throw new Error('schemaVersion must be the integer 1')
      }

      return value
    })
  } catch (error) {
    throw new Error(`manifest.json: invalid JSON (${error.message})`)
  }

  if (
    !manifest ||
    Array.isArray(manifest) ||
    typeof manifest !== 'object' ||
    Object.keys(manifest).some(
      (key) => !['schemaVersion', 'name', 'entrypoint', 'editor'].includes(key)
    ) ||
    manifest.schemaVersion !== 1 ||
    typeof manifest.name !== 'string' ||
    !manifest.name.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '') ||
    [...manifest.name].length > 80 ||
    !manifest.name.isWellFormed() ||
    typeof manifest.entrypoint !== 'string'
  ) {
    throw new Error(
      'manifest.json: expected schemaVersion: 1, a nonblank name (1–80 Unicode characters), entrypoint, and an optional editor; no other properties'
    )
  }

  assertPath(manifest.entrypoint)

  if (path.posix.extname(manifest.entrypoint) !== '.html') {
    throw new Error('manifest.json: entrypoint must end in .html')
  }

  if (manifest.editor != null) {
    if (
      Array.isArray(manifest.editor) ||
      typeof manifest.editor !== 'object' ||
      Object.keys(manifest.editor).some((key) => key !== 'entrypoint') ||
      typeof manifest.editor.entrypoint !== 'string'
    ) {
      throw new Error(
        'manifest.json: editor must be null or an object with only an entrypoint string'
      )
    }

    assertPath(manifest.editor.entrypoint)

    if (path.posix.extname(manifest.editor.entrypoint) !== '.html') {
      throw new Error('manifest.json: editor.entrypoint must end in .html')
    }
  }

  return manifest
}

// Central-directory names are read as raw bytes, like Go archive/zip. Do not
// normalize backslashes or let Unicode extra fields override the actual path.
export async function validateArchive(data) {
  if (!data.length || data.length > limits.zip) {
    throw new Error('ZIP size must be between 1 byte and 10 MiB')
  }

  const zip = await yauzl.fromBufferPromise(data, {
    decodeStrings: false,
    validateEntrySizes: true,
  })

  try {
    if (!zip.entryCount || zip.entryCount > limits.entries) {
      throw new Error('ZIP must contain 1–100 entries, including directories')
    }

    const seen = new Set()
    const files = new Set()

    let expandedBytes = 0
    let entries = 0
    let manifest

    for await (const entry of zip.eachEntry()) {
      if (++entries > limits.entries) {
        throw new Error('ZIP exceeds 100 entries')
      }

      const rawName = new TextDecoder('utf-8', {
        fatal: true,
        ignoreBOM: true,
      }).decode(entry.fileName)
      const creator = entry.versionMadeBy >>> 8
      const unixType = (entry.externalFileAttributes >>> 16) & 0o170000
      const unix = creator === 3 || creator === 19
      const dos = creator === 0 || creator === 10 || creator === 14
      const directory =
        rawName.endsWith('/') ||
        (unix && unixType === 0o040000) ||
        (dos && (entry.externalFileAttributes & 0x10) !== 0)
      const name =
        directory && rawName.endsWith('/') ? rawName.slice(0, -1) : rawName

      assertPath(name)

      if (seen.has(name.toLowerCase())) {
        throw new Error(`${name}: duplicate path (case insensitive)`)
      }

      seen.add(name.toLowerCase())

      if (entry.generalPurposeBitFlag & 1) {
        throw new Error(`${name}: encrypted entries are unsupported`)
      }

      if (unix && ![0, 0o100000, 0o040000].includes(unixType)) {
        throw new Error(
          `${name}: only regular files and directories are supported`
        )
      }

      if (directory) {
        continue
      }

      assertFile(name)

      const limit = Math.min(
        name === 'manifest.json' ? limits.manifest : limits.file,
        limits.expanded - expandedBytes
      )

      if (entry.uncompressedSize > limit) {
        throw new Error(
          `${name}: expanded size limit exceeded (${limit} bytes)`
        )
      }

      const stream = await zip.openReadStreamPromise(entry)
      const bytes = await readBounded(stream, limit, name)

      if (crc32(bytes) !== entry.crc32) {
        throw new Error(`${name}: CRC mismatch (corrupt ZIP entry)`)
      }

      expandedBytes += bytes.length

      if (name === 'manifest.json') {
        manifest = parseManifest(bytes)
      } else {
        files.add(name)
      }
    }

    if (entries !== zip.entryCount) {
      throw new Error('ZIP entry count mismatch')
    }

    if (!manifest) {
      throw new Error('manifest.json: missing at ZIP root')
    }

    if (!files.has(manifest.entrypoint)) {
      throw new Error(
        `${manifest.entrypoint}: manifest entrypoint does not exist (case sensitive)`
      )
    }

    if (manifest.editor != null && !files.has(manifest.editor.entrypoint)) {
      throw new Error(
        `${manifest.editor.entrypoint}: manifest editor entrypoint does not exist (case sensitive)`
      )
    }

    const lowerFiles = new Set([...files].map((name) => name.toLowerCase()))

    for (const name of files) {
      for (
        let parent = path.posix.dirname(name);
        parent !== '.';
        parent = path.posix.dirname(parent)
      ) {
        if (lowerFiles.has(parent.toLowerCase())) {
          throw new Error(`${name}: file/directory collision at ${parent}`)
        }
      }
    }

    return {
      manifest,
      entries,
      files: [...files],
      zipBytes: data.length,
      expandedBytes,
    }
  } finally {
    zip.close()
  }
}
