// Starts a chel relay for the e2e run, on its own port and its own database so
// it cannot touch the one `npm run serve` uses.
//
// chel reads chel.toml from the working directory and resolves the sqlite path
// relative to it, so the whole thing is driven by running from a scratch
// directory. The app and the contracts are passed in as absolute paths.

import { randomUUID } from 'node:crypto'
import { rm, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chel } from '../../scripts/chel.mjs'
import { DASHBOARD_PORT, PORT } from './ports.mjs'

const root = path.resolve(import.meta.dirname, '../..')
const workDir = path.join(root, 'data/e2e')

// A fresh database every run, so a test never sees an account another run made.
await rm(workDir, { recursive: true, force: true })
await mkdir(workDir, { recursive: true })

await writeFile(path.join(workDir, 'chel.toml'), `server_id = "${randomUUID()}"

[server]
host = "127.0.0.1"
port = ${PORT}
dashboardPort = ${DASHBOARD_PORT}

[database]
backend = "sqlite"

[database.backendOptions.sqlite]
filepath = "chelonia.db"
`)

process.chdir(workDir)

chel([
  'serve',
  '--port', String(PORT),
  '--dashboard-port', String(DASHBOARD_PORT),
  '--manifests-dir', path.join(root, 'contracts'),
  path.join(root, 'dist')
])
