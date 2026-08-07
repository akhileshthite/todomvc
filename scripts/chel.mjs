import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import process from 'node:process'

const require = createRequire(import.meta.url)
const CHEL_BIN = require.resolve('@chelonia/cli/bin/chel.js')

// The @chelonia/cli 3.4.0 binary is compiled with `--allow-write=./`, so it
// cannot write Deno's plug cache to fetch the SQLite3 library and every command
// fails with "Failed to load SQLite3 Dynamic Library". Pointing
// DENO_SQLITE_PATH at the system library skips the download.
// Remove once the published binary has the permission it needs.
const SYSTEM_SQLITE = {
  darwin: '/usr/lib/libsqlite3.dylib',
  linux: '/usr/lib/x86_64-linux-gnu/libsqlite3.so.0'
}

export function chel (args) {
  const { status, signal } = spawnSync(process.execPath, [CHEL_BIN, ...args], {
    stdio: 'inherit',
    env: {
      ...process.env,
      DENO_SQLITE_PATH: process.env.DENO_SQLITE_PATH ?? SYSTEM_SQLITE[process.platform] ?? ''
    }
  })
  if (status !== 0) {
    throw new Error(`chel ${args.join(' ')} exited with ${status ?? signal}`)
  }
}

// Allow `node scripts/chel.mjs <args>` as a drop-in for the `chel` command.
if (process.argv[1] === new URL(import.meta.url).pathname) {
  chel(process.argv.slice(2))
}
