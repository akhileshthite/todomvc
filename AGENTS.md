# Working on this repo

## Layout

```
src/contracts/identity.js   the account contract. chel signs it, Chelonia
                            evaluates it in a sandbox, it is not bundled
src/contracts/list.js       one todo list, with the rename action
src/chelonia/config.js      chelonia/configure and chelonia/connect
src/chelonia/state.js       the reactive root state, and saving it
src/chelonia/auth.js        signup, login, logout, restore
src/chelonia/lists.js       creating a list, inviting, joining
src/chelonia/lists-model.js the lists schema and its one reducer, both pure
src/chelonia/todos.js       the todos slot and the six writes
src/chelonia/todos-model.js the schema and the reducers, both pure
src/chelonia/offline.js     the queue for writes made while the server is away
src/components/             Vue, and nothing else
scripts/build-contracts.mjs chel manifest -> chel pin -> manifest CID
scripts/chel.mjs            runs chel from node_modules, see below
docs/data.md                the todos slot and the writes, with code
docs/login.md               signup and login, step by step
docs/sharing.md             how sharing works, message by message
```

Everything Chelonia touches is under `src/chelonia/`. The components import a
few functions from it and know nothing about etags, subscriptions or conflicts.
Nothing under `src/chelonia/` depends on Vue except the state object.

## Scripts

| command | what it does |
| --- | --- |
| `npm run contracts` | signs, versions and pins the contracts, writes their manifest CIDs for the app |
| `npm run build` | the above, plus the Vite build into `dist/` |
| `npm run serve` | `chel serve --dev dist`, which uploads `contracts/` and serves the app |
| `npm start` | build, then serve |
| `npm run dev` | rebuilds on change; run `npm run serve` in another shell |
| `npm run lint` | eslint |
| `npm test` | unit tests for the slot schemas and the reducers |
| `npm run test:e2e` | Playwright against a real server on its own port and database |
| `npm run test:all` | both |

The first `npm run contracts` writes two files that are not committed: a
contract signing key under `.keys/`, and `chel.toml`, chel's own config (port,
database backend, and a `server_id` the server refuses to start without).
`chel init` generates it with the in-memory backend, which loses every account
on restart, so the script switches it to sqlite under `data/`.

`npm run serve` runs the real server as a child of `scripts/chel.mjs`, so
killing the node process alone leaves it up. Stop it through the port:
`lsof -ti:8000 | xargs kill`.

After a full rebuild, restart `npm run serve`. Vite empties `dist/` and a
server that was already running answers 404 until it is restarted.

The app is built with `LIGHTWEIGHT_CLIENT=true` (see `vite.config.js`), the
same as Group Income: the browser keeps no message log, and Chelonia reads each
contract's HEAD from the saved state.

The contract version comes from `version` in `package.json`. Editing a contract
without bumping it makes the build stop, since the app would then be built
against a manifest the accounts already on the server do not have.

## Workarounds waiting on an upstream release

Each one is fenced in the source with `TODO: BEGIN REMOVEME (issue)` and
`TODO: END REMOVEME (issue)`, so `grep REMOVEME` finds them all.

- `scripts/chel.mjs` and `.github/workflows/ci.yml`: the published
  `@chelonia/cli` 3.4.0 cannot load SQLite on its own, so chel is run with
  `DENO_SQLITE_PATH` pointing at the system library. Fixed by
  [chel#162](https://github.com/okTurtles/chel/pull/162), tracked as
  [chel#150](https://github.com/okTurtles/chel/issues/150). Until a release
  ships, run chel as `node scripts/chel.mjs <args>`.
- `src/contracts/identity.js`, `src/chelonia/config.js`,
  `scripts/build-contracts.mjs`: the account contract has to be named
  `gi.contracts/identity`, Group Income's name, because chel only accepts a
  contract created without an account to bill it to under that exact name.
  [chel#160](https://github.com/okTurtles/chel/issues/160).
- `src/chelonia/auth.js`, `lookupUsername`: replaced by
  `chelonia/out/nameToContractID` once a `@chelonia/lib` release has
  [libcheloniajs#90](https://github.com/okTurtles/libcheloniajs/issues/90).
- `src/chelonia/auth.js`, signup error message: the publish error carries the
  HTTP status once a release has the fix for
  [libcheloniajs#94](https://github.com/okTurtles/libcheloniajs/issues/94).
- `src/chelonia/auth.js`, `USERNAME_REGEX`: a copy of chel's private
  `NAME_REGEX`. Goes once chel exports the rule.
- `src/chelonia/auth.js`, the key list in `signup`: gets shorter once
  [libcheloniajs#91](https://github.com/okTurtles/libcheloniajs/issues/91)
  lands. Not a removal, so it is a plain TODO.

## Accounts from before lists existed

Their todos were a slot on the identity contract and this version does not look
there. The account, the username and the password still work; the old todos do
not appear. There is no migration, since nothing has shipped.
