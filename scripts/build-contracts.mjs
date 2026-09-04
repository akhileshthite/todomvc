// Prepares the contracts in src/contracts/ for both the server and the app:
//
//   chel init / keygen   once, for chel.toml and the signing key
//   chel manifest        signs a contract
//   chel pin             copies it into contracts/<name>/<version>/, where
//                        chel serve looks for contracts to upload
//   createCID            the manifest CID, written to src/contracts/manifests.json
//
// The app passes those CIDs to chelonia/configure as contracts.manifests.

import { createCID, multicodes } from '@chelonia/lib/functions'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chel } from './chel.mjs'

const CONTRACTS = [
  // TODO: rename once the fix for okTurtles/chel#160 is merged and released.
  // Until then chel only accepts a contract created without an account to bill
  // it to when the manifest name is exactly this.
  { name: 'gi.contracts/identity', file: 'identity.js' },
  // A list is created by an identity, so it is attributed and its name is free.
  { name: 'todomvc/list', file: 'list.js' }
]

const root = path.resolve(import.meta.dirname, '..')
const at = (...p) => path.join(root, ...p)

// Single version source-of-truth
// Updating version in package.json will allow pinning to automatically
// choose the new version.
// Any account created with an old version keeps using the old manifest.
const VERSION = JSON.parse(await readFile(at('package.json'), 'utf8')).version

const keyFile = at('.keys/contract-signing-key.json')
const buildDir = at('build/contracts')

process.chdir(root)

await mkdir(at('data'), { recursive: true })

if (!existsSync(at('chel.toml'))) {
  chel(['init'])
  // chel init defaults to the in-memory backend, which loses every account
  // when the server restarts, so use sqlite.
  const config = await readFile(at('chel.toml'), 'utf8')
  const sqlite = config
    .replace('backend = "mem"', 'backend = "sqlite"')
    .replace('# [database.backendOptions.sqlite]\n# filepath = "data/chelonia.db"',
      '[database.backendOptions.sqlite]\nfilepath = "data/chelonia.db"')
  // Fail loudly if chel changed its template, instead of serving from a
  // half-edited config.
  if (!sqlite.includes('filepath = "data/chelonia.db"') || sqlite.includes('backend = "mem"')) {
    console.error('chel.toml is not what this script expects. Edit it by hand:\n' + sqlite)
    process.exit(1)
  }
  await writeFile(at('chel.toml'), sqlite)
}

if (!existsSync(keyFile)) {
  await mkdir(at('.keys'), { recursive: true })
  chel(['keygen', '--out', keyFile, '--pubout', at('.keys/contract-signing-key.pub.json')])
}

await mkdir(buildDir, { recursive: true })

const manifests = {}

for (const { name, file } of CONTRACTS) {
  const sourcePath = at('src/contracts', file)
  const source = await readFile(sourcePath)
  const pinnedDir = at('contracts', name.replace('/', '_'), VERSION)
  const pinnedSource = path.join(pinnedDir, file)

  // Editing a contract without bumping the version would give the same version
  // a new manifest CID. The app would be rebuilt against it while every
  // contract already on the relay still points at the old one, and those
  // accounts would stop loading. Better to say so than to let it happen
  // quietly.
  if (existsSync(pinnedSource) && !source.equals(await readFile(pinnedSource))) {
    console.error(
      `src/contracts/${file} changed but the version is still ${VERSION}.\n` +
      'Bump "version" in package.json, or delete data/ and contracts/ to start fresh.'
    )
    process.exit(1)
  }

  // chel manifest records the contract by basename and chel deploy resolves it
  // next to the manifest, so both have to be in the same directory.
  const contractCopy = path.join(buildDir, file)
  const manifestFile = path.join(buildDir, `${path.parse(file).name}.${VERSION}.manifest.json`)
  await copyFile(sourcePath, contractCopy)

  chel([
    'manifest',
    '--name', name,
    '--contract-version', VERSION,
    '--out', manifestFile,
    keyFile,
    contractCopy
  ])

  chel(['pin', '--overwrite', path.relative(root, manifestFile), VERSION])

  const pinned = path.join(pinnedDir, path.basename(manifestFile))
  manifests[name] = createCID(await readFile(pinned), multicodes.SHELTER_CONTRACT_MANIFEST)
}

await writeFile(
  at('src/contracts/manifests.json'),
  JSON.stringify({ manifests }, null, 2) + '\n'
)

for (const [name, cid] of Object.entries(manifests)) {
  console.log(`${name} -> ${cid}`)
}
