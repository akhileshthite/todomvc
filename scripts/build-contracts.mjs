// Prepares src/contracts/identity.js for both the server and the app:
//
//   chel init / keygen   once, for chel.toml and the signing key
//   chel manifest        signs the contract
//   chel pin             copies it into contracts/<name>/<version>/, where
//                        chel serve looks for contracts to upload
//   createCID            the manifest CID, written to src/contracts/manifests.json
//
// The app passes that CID to chelonia/configure as contracts.manifests.

import { createCID, multicodes } from '@chelonia/lib/functions'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chel } from './chel.mjs'

const VERSION = '1.0.0'
const CONTRACT_NAME = 'gi.contracts/identity'
const SOURCE = 'src/contracts/identity.js'

const root = path.resolve(import.meta.dirname, '..')
const at = (...p) => path.join(root, ...p)

const keyFile = at('.keys/contract-signing-key.json')
const buildDir = at('build/contracts')
const contractCopy = path.join(buildDir, 'identity.js')
const manifestFile = path.join(buildDir, `identity.${VERSION}.manifest.json`)

process.chdir(root)

await mkdir(at('data'), { recursive: true })

if (!existsSync(at('chel.toml'))) {
  chel(['init'])
  // chel init defaults to the in-memory backend, which loses every account
  // when the server restarts, so use sqlite.
  const config = await readFile(at('chel.toml'), 'utf8')
  await writeFile(at('chel.toml'), config
    .replace('backend = "mem"', 'backend = "sqlite"')
    .replace('# [database.backendOptions.sqlite]\n# filepath = "data/chelonia.db"',
      '[database.backendOptions.sqlite]\nfilepath = "data/chelonia.db"'))
}

if (!existsSync(keyFile)) {
  await mkdir(at('.keys'), { recursive: true })
  chel(['keygen', '--out', keyFile, '--pubout', at('.keys/contract-signing-key.pub.json')])
}

const source = await readFile(at(SOURCE))
const pinnedDir = at('contracts', CONTRACT_NAME.replace('/', '_'), VERSION)
const pinnedSource = path.join(pinnedDir, 'identity.js')

// Editing the contract without bumping VERSION would give the same version a
// new manifest CID. The app would be rebuilt against it while every contract
// already on the relay still points at the old one, and those accounts would
// stop loading. Better to say so than to let it happen quietly.
if (existsSync(pinnedSource) && !source.equals(await readFile(pinnedSource))) {
  console.error(
    `${SOURCE} changed but VERSION is still ${VERSION}.\n` +
    'Bump VERSION in this script, or delete data/ and contracts/ to start fresh.'
  )
  process.exit(1)
}

// chel manifest records the contract by basename and chel deploy resolves it
// next to the manifest, so both have to be in the same directory.
await mkdir(buildDir, { recursive: true })
await copyFile(at(SOURCE), contractCopy)

chel([
  'manifest',
  '--name', CONTRACT_NAME,
  '--contract-version', VERSION,
  '--out', manifestFile,
  keyFile,
  contractCopy
])

chel(['pin', '--overwrite', path.relative(root, manifestFile), VERSION])

const pinned = path.join(pinnedDir, path.basename(manifestFile))
const manifestCID = createCID(await readFile(pinned), multicodes.SHELTER_CONTRACT_MANIFEST)

await writeFile(
  at('src/contracts/manifests.json'),
  JSON.stringify({ manifests: { [CONTRACT_NAME]: manifestCID } }, null, 2) + '\n'
)

console.log(`${CONTRACT_NAME} -> ${manifestCID}`)
