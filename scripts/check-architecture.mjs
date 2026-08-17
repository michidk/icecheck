import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

const root = new URL('..', import.meta.url)
const violations = []

await inspectTree('src/modules', (file, source) => {
  if (/from\s+['"][^'"]*\/routes\//u.test(source)) {
    violations.push(`${file}: feature modules must not import route-owned code`)
  }
})

await inspectTree('src/routes', (file, source) => {
  if (/from\s+['"][^'"]*modules\/icecheck\/(?:lib|hooks|protocol)\//u.test(source)) {
    violations.push(`${file}: routes may consume icecheck components, not feature internals`)
  }
})

await inspectTree('server', (file, source) => {
  if (/from\s+['"][^'"]*icecheck\/lib\//u.test(source)) {
    violations.push(`${file}: the server must not depend on browser feature internals`)
  }
})

if (violations.length) {
  console.error(violations.join('\n'))
  process.exitCode = 1
} else {
  console.log('Architecture boundaries verified.')
}

async function inspectTree(relativeDirectory, inspect) {
  const directory = new URL(`${relativeDirectory}/`, root)
  for (const entry of await walk(directory)) {
    if (!/\.(?:mjs|ts|tsx)$/u.test(entry.pathname) || entry.pathname.endsWith('/routeTree.gen.ts')) continue
    const relative = path.relative(root.pathname, entry.pathname)
    inspect(relative, await readFile(entry, 'utf8'))
  }
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory)
    if (entry.isDirectory()) files.push(...await walk(url))
    else files.push(url)
  }
  return files
}
