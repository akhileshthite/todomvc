# TodoMVC on Chelonia

A todo list where the server stores your data but cannot read it, and where two
browser windows stay in sync without any sync code in the UI.

It is meant to be read as much as run. If you have never used Chelonia before,
start here and then go to the [library
docs](https://github.com/okTurtles/libcheloniajs/tree/main/docs).

## What Chelonia is

[Shelter Protocol](https://shelterprotocol.net/) is a protocol for apps where
the server holds the data but the keys stay with the user. Chelonia is its
JavaScript implementation: [`@chelonia/lib`](https://www.npmjs.com/package/@chelonia/lib)
is the client library and [`@chelonia/cli`](https://www.npmjs.com/package/@chelonia/cli)
(the `chel` command) is the tooling and the server.

Six words you need before reading the code.

**Relay.** The server. It stores messages, relays them to whoever is
subscribed, and answers a few HTTP routes. It checks that a message chain is
well formed, but it does not run your app's logic and it cannot read encrypted
payloads.

**Contract.** An append-only log of signed messages, identified by a contract
ID. A contract also has code: `validate` and `process` functions that every
client runs over the log to build up the contract's state. Because the code is
on the client, the relay never has to be trusted with the rules.

**Action.** One message appended to a contract's log, usually encrypted. This
is the on-chain way to change state.

**Keys.** Every contract owns keys. A signing key (`csk`) proves who wrote a
message, an encryption key (`cek`) makes the payload unreadable to the relay.
Secret keys live in the browser. A contract can carry its own secret keys
inside itself, encrypted, which is how logging in on a new machine works.

**Manifest.** A signed file pointing at the contract's source. Clients fetch
it, check the signature, then evaluate the source in a sandbox. That is why the
contract in this repo is not bundled with the app.

**KV store.** A per-contract key/value store at `/kv/:contractID/:key`, last
write wins, values signed and encrypted like everything else. For data where a
full log would be overkill. A **slot** is a typed declaration of one key; the
library then handles fetching, caching, live updates and write conflicts.

Everything is called through [`sbp`](https://github.com/okTurtles/sbp-js), a
selector-based dispatcher, so calls look like
`sbp('chelonia/kv/update', { ... })` rather than method calls on an object.

## Why a contract and why a KV slot

This app uses both, and choosing between them is the main lesson.

The **contract** here is an identity contract. It exists on the relay, it owns
the keys, and it is what `/kv/:contractID/:key` hangs off. Registering it is
what claims the username.

The **todos** are one KV slot on that contract. Only the latest version of the
list matters. Writing every keystroke into an append-only log would be the
wrong shape, and it is a mistake real apps made before the KV slot API landed
([libcheloniajs#80](https://github.com/okTurtles/libcheloniajs/pull/80)).

Rule of thumb: use contract actions when history, ordering and multi-party
validation matter, and KV slots when only the latest value matters.

The UI is Vue, but nothing under `src/chelonia/` depends on it except the state
object, so the same code works with any framework.

## Running it

Node 22 or newer.

```bash
npm install
npm start
```

Then open <http://localhost:8000/app/>.

`npm start` builds the contract and the app and starts the relay. The pieces:

| command | what it does |
| --- | --- |
| `npm run contracts` | signs, versions and pins the contract, writes the manifest CID for the app |
| `npm run build` | the above, plus the Vite build into `dist/` |
| `npm run serve` | `chel serve --dev dist`, which uploads `contracts/` and serves the app |
| `npm run dev` | rebuilds on change; run `npm run serve` in another shell |
| `npm test` | unit tests for the slot schema and the reducers |
| `npm run test:e2e` | Playwright against a real relay on its own port and database |
| `npm run test:all` | both |

The first `npm run contracts` also writes two files it does not commit: a
contract signing key under `.keys/`, and `chel.toml`, which is chel's own
config (port, database backend, and a `server_id` the server refuses to start
without). `chel init` generates it with the in-memory backend, which loses
every account on restart, so the script switches it to sqlite under `data/`.

After a full rebuild, restart `npm run serve`. Vite empties `dist/` and a
server that was already running answers 404 until it is restarted.

## What to try

1. Create an account. The keys are generated in the browser and the relay only
   ever sees a blinded hash of the password.
2. Add a few todos, complete some, edit one by double clicking it.
3. Open a second window on the same URL. It follows along. Nothing in the UI
   subscribes to anything; that is the relay pushing the new value and the
   library writing it into local state.
4. Type in both windows at once. Both end up with the same list, because every
   write is a reducer and Chelonia re-runs it against the relay's copy when
   someone else got there first.
5. Reload. The session comes back from the saved state.
6. Log out, then log in again with the same username and password. Nothing
   local is reused, so this is the real recovery path: the keys come back out
   of the contract.
7. See what the relay actually stores:

   ```bash
   node scripts/chel.mjs eventsAfter <contract-id> 0
   ```

   The payload is an encrypted envelope. Pass `--keys` with a dump of
   `secretKeys` from the saved state to read it.

## Layout

```
src/contracts/identity.js   the contract. chel signs it, Chelonia evaluates it
                            in a sandbox, it is not bundled with the app
src/chelonia/config.js      chelonia/configure and chelonia/connect
src/chelonia/state.js       the reactive root state, and saving it
src/chelonia/auth.js        signup, login, logout, restore
src/chelonia/todos.js       the KV slot and the six writes
src/chelonia/todos-model.js the schema and the reducers, both pure
src/components/             Vue, and nothing else
scripts/build-contracts.mjs chel manifest -> chel pin -> manifest CID
```

Everything Chelonia touches is under `src/chelonia/`. The components import a
few functions from it and know nothing about etags, subscriptions or conflicts.

### The data

The slot is declared once, at startup:

```js
sbp('chelonia/kv/defineSlot', {
  contractType: 'gi.contracts/identity',
  key: 'todos',
  defaultValue: {},
  schema: todosSchema,
  match: (contractID) => contractID === state.loggedIn?.identityContractID
})
```

`gi.contracts/identity` is Group Income's contract name, but the contract is
this repo's own, in `src/contracts/identity.js`. chel only lets a contract with
that exact name be created without an account to bill it to, so an app with its
own signup has no choice yet. See
[chel#160](https://github.com/okTurtles/chel/issues/160).

After that every write is a reducer:

```js
sbp('chelonia/kv/update', {
  contractID,
  key: 'todos',
  updater: (prev) => ({ ...prev, [id]: { title, completed: false, createdDate } })
})
```

No etags, no conflict callback, no per-key event. The relay rejects a write
that was based on a stale value, and Chelonia responds by refetching and
running the reducer again on the newer one. That is why two windows converge.
Returning `KV_NOOP` from a reducer cancels the write, which is how toggling a
todo that is already in that state avoids a pointless round trip.

Reading does not go over the network. Chelonia keeps a local copy of every
declared slot at `rootState._kv[contractID][key]` and updates it from four
places: the first load, a push from another client, our own write, and a
refetch after the socket reconnects. That state object is a Vue `reactive()`,
so a `computed` over it reruns on all four and the list redraws by itself.

### Login

This is the part with no small example elsewhere, so it is worth reading in
full in `src/chelonia/auth.js`.

**Signup**

1. Register a salt against `/zkpp/register/:username`. The relay gets a blinded
   hash, never the password, and returns a salt plus a one-time token.
2. Derive two keys from the password and that salt: `ipk` for signing and `iek`
   for encryption. Neither is ever stored.
3. Generate the everyday keys, `csk`, `cek` and `sak`. Their secret halves go
   into the contract encrypted to the `iek`.
4. `chelonia/out/registerContract`, signed by the `ipk`, with the username in
   the `shelter-namespace-registration` header and the token in
   `shelter-salt-registration-token`.
5. Keep `csk`, `cek` and `sak`. Discard `ipk` and `iek`.

**Login**

1. `GET /name/:username` gives the contract ID.
2. Prove the password against `/zkpp/:contractID/auth_hash` and
   `/contract_hash`, which returns the same salt as at signup.
3. Derive the `iek` and hand it to Chelonia as a transient key.
4. `chelonia/contract/retain`. Syncing the contract decrypts `csk`, `cek` and
   `sak` with the `iek` and stores them. That is the whole recovery.
5. Discard the `iek`.

**Reload** does none of that. The keys and the contract state are already in
the saved blob, so it only re-syncs.

[Group Income](https://github.com/okTurtles/group-income) does the same thing
through a service worker, an encrypted settings database and a Vuex login
event. None of that is needed for one tab and one contract.
