import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const CHEL_BIN = require.resolve('@chelonia/cli/bin/chel.js')

// The @chelonia/cli 3.4.0 binary is compiled with `--allow-write=./`, so it
// cannot write Deno's plug cache to fetch the SQLite3 library and every command
// fails with "Failed to load SQLite3 Dynamic Library". Pointing
// DENO_SQLITE_PATH at the system library skips the download.
// TODO: drop this once the published binary has the permission it needs,
// okTurtles/chel#150.
//
// These paths are conventional, not guaranteed, so on Linux take the first one
// that is actually there. On macOS the system libraries live in the dyld shared
// cache and there is no file to stat, so the path is used as given.
// DENO_SQLITE_PATH from the environment always wins.
const SYSTEM_SQLITE = {
  darwin: ['/usr/lib/libsqlite3.dylib'],
  linux: [
    `/usr/lib/${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-linux-gnu/libsqlite3.so.0`,
    '/usr/lib64/libsqlite3.so.0',
    '/usr/lib/libsqlite3.so.0'
  ]
}

const candidates = SYSTEM_SQLITE[process.platform] ?? []
const found = process.platform === 'darwin'
  ? candidates[0]
  : candidates.find((p) => existsSync(p))
const DENO_SQLITE_PATH = process.env.DENO_SQLITE_PATH ?? found ?? ''

export function chel (args) {
  const { status, signal } = spawnSync(process.execPath, [CHEL_BIN, ...args], {
    stdio: 'inherit',
    env: { ...process.env, DENO_SQLITE_PATH }
  })
  if (status !== 0) {
    throw new Error(`chel ${args.join(' ')} exited with ${status ?? signal}`)
  }
}

// Allow `node scripts/chel.mjs <args>` as a drop-in for the `chel` command.
// fileURLToPath, not URL.pathname: pathname is percent-encoded, so a checkout
// path containing a space would never match and this would silently do nothing.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  chel(process.argv.slice(2))
}
