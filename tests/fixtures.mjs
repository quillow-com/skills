import { readFile } from 'node:fs/promises'
import { crc32, deflateRawSync } from 'node:zlib'

export const manifest = {
  schemaVersion: 1,
  name: 'Calculator',
  entrypoint: 'index.html',
}

export function baseFiles(value = JSON.stringify(manifest)) {
  return [
    { name: 'manifest.json', data: value },
    { name: 'index.html', data: '<h1>Test</h1>' },
  ]
}

export async function configPageExample() {
  const guide = await readFile(
    new URL(
      '../skills/quillow-custom-block/references/config-page.md',
      import.meta.url
    ),
    'utf8'
  )
  const snippets = [...guide.matchAll(/```(json|html|js)\n([\s\S]*?)```/g)]
  const scripts = snippets.filter(([, language]) => language === 'js')

  return {
    manifest: JSON.parse(
      snippets.find(([, language]) => language === 'json')[2]
    ),
    html: snippets.find(([, language]) => language === 'html')[2],
    editorScript: scripts[0][2],
    readerScript: scripts[1][2],
    openerScript: scripts[2][2],
  }
}

// Small independent ZIP writer: allows malformed metadata that production ZIP
// libraries deliberately refuse to create. No extraction or external fixtures.
export function archive(files) {
  const locals = []
  const central = []
  let offset = 0

  for (const file of files) {
    const name = Buffer.from(file.name)
    const data = Buffer.from(file.data ?? '')
    const compressed = file.store ? data : deflateRawSync(data)
    const checksum = file.crc ?? crc32(data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(file.flags ?? 0, 6)
    local.writeUInt16LE(file.store ? 0 : 8, 8)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(file.size ?? data.length, 22)
    local.writeUInt16LE(name.length, 26)
    locals.push(local, name, compressed)

    const header = Buffer.alloc(46)
    header.writeUInt32LE(0x02014b50)
    header.writeUInt16LE(0x0314, 4)
    header.writeUInt16LE(20, 6)
    header.writeUInt16LE(file.flags ?? 0, 8)
    header.writeUInt16LE(file.store ? 0 : 8, 10)
    header.writeUInt32LE(checksum, 16)
    header.writeUInt32LE(compressed.length, 20)
    header.writeUInt32LE(file.size ?? data.length, 24)
    header.writeUInt16LE(name.length, 28)
    header.writeUInt32LE(((file.mode ?? 0o100644) << 16) >>> 0, 38)
    header.writeUInt32LE(offset, 42)
    central.push(header, name)
    offset += local.length + name.length + compressed.length
  }

  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)

  return Buffer.concat([...locals, directory, end])
}
