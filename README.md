# TodoMVC on Chelonia

A todo list where the server stores your data but cannot read it, where two
browser windows stay in sync without any sync code in the UI, and where a list
can be shared with another account without the server ever holding a key.

It is meant to be read as much as run. If you have never used Chelonia before,
start here and then go to the [library
docs](https://github.com/okTurtles/libcheloniajs/tree/main/docs).

## What Chelonia is

[Shelter Protocol](https://shelterprotocol.net/) is a protocol for apps where
the server holds the data but the keys stay with the user. Chelonia is its
JavaScript implementation: [`@chelonia/lib`](https://www.npmjs.com/package/@chelonia/lib)
is the client library and [`@chelonia/cli`](https://www.npmjs.com/package/@chelonia/cli)
(the `chel` command) is the tooling and the server.

Seven words you need before reading the code.

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
contracts in this repo are not bundled with the app.

**Key sharing.** One account handing another account a contract's keys, with an
`OP_KEY_SHARE` message. The relay passes it along and cannot read it, so the
account holding the keys has to be online to send it.

**KV store.** A per-contract key/value store at `/kv/:contractID/:key`, last
write wins, values signed and encrypted like everything else. For data where a
full log would be overkill. A **slot** is a typed declaration of one key; the
library then handles fetching, caching, live updates and write conflicts.

Everything is called through [`sbp`](https://github.com/okTurtles/sbp-js), a
selector-based dispatcher, so calls look like
`sbp('chelonia/kv/update', { ... })` rather than method calls on an object.

## Why a contract and why a KV slot

This app uses both, and choosing between them is the main lesson.

There are two contracts. The **identity contract** is the account: registering
it claims the username, and it holds the keys everything else is unlocked with.
A **list contract** is one todo list. It exists so the list has keys of its own,
which is what makes it shareable.

The **todos** of a list are one KV slot on its list contract. Only the latest
version of the list matters. Writing every keystroke into an append-only log
would be the wrong shape, and it is a mistake real apps made before the KV slot
API landed ([libcheloniajs#80](https://github.com/okTurtles/libcheloniajs/pull/80)).

The **title** of a list is an action, not a slot, so the same lesson runs the
other way: it is small, it changes rarely, and everyone sharing the list should
see the same history of who renamed it to what.

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

`npm start` builds the contracts and the app and starts the relay. The pieces:

| command | what it does |
| --- | --- |
| `npm run contracts` | signs, versions and pins both contracts, writes their manifest CIDs for the app |
| `npm run build` | the above, plus the Vite build into `dist/` |
| `npm run serve` | `chel serve --dev dist`, which uploads `contracts/` and serves the app |
| `npm run dev` | rebuilds on change; run `npm run serve` in another shell |
| `npm test` | unit tests for the slot schemas and the reducers |
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
7. Share a list. Press **Share**, open the link in a different browser (a
   private window is enough, a second tab is not, since tabs share storage),
   sign up there and join. Keep the first window open while you do: it is the
   one that answers. Then type in both.
8. See what the relay actually stores:

   ```bash
   node scripts/chel.mjs eventsAfter <contract-id> 0
   ```

   The payload is an encrypted envelope. Pass `--keys` with a dump of
   `secretKeys` from the saved state to read it.

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
src/components/             Vue, and nothing else
scripts/build-contracts.mjs chel manifest -> chel pin -> manifest CID
```

Everything Chelonia touches is under `src/chelonia/`. The components import a
few functions from it and know nothing about etags, subscriptions or conflicts.

### The data

Two slots are declared once, at startup. `lists` on the identity contract holds
the IDs of the lists this account is in, and `todos` attaches to each of those
lists:

```js
sbp('chelonia/kv/defineSlot', {
  contractType: 'todomvc/list',
  key: 'todos',
  defaultValue: {},
  schema: todosSchema,
  match: (contractID, contractState) =>
    currentLists().includes(contractID) &&
    !!sbp('chelonia/contract/currentKeyIdByName', contractState, '#sak', true)
})
```

`match` decides which contracts a slot attaches to. The second half of it is
what makes a shared list wait: a list you have just joined is in `lists`, but
until its keys arrive there is nothing you could read or write, because
`/kv/:contractID/:key` is authorized with the contract's own `#sak`.

`gi.contracts/identity` is Group Income's contract name, but the contract is
this repo's own, in `src/contracts/identity.js`. chel only lets a contract with
that exact name be created without an account to bill it to, so an app with its
own signup has no choice yet. See
[chel#160](https://github.com/okTurtles/chel/issues/160). A list is created by
an account, so it is billed to that account and its name is ours to pick.

Every write is a reducer:

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

### Sharing a list

The relay cannot grant anyone access, because it holds no keys. The only way to
let a second account into a list is for the first account's browser to hand the
list's keys over, and the protocol operation for that is `OP_KEY_SHARE`. Read
`src/chelonia/lists.js` alongside this.

**Creating a list**

`chelonia/out/registerContract` with `publishOptions.billableContractID` set to
the account's identity contract, so the relay knows who pays for it. The list
gets its own `csk`, `cek` and `#sak`, each stored in the contract encrypted to
the list's own `cek` and marked `shareable: true`. That flag is what an invite
hands over.

Then the same three keys are sent to the creator's *own* identity contract with
`chelonia/out/keyShare`, encrypted to the identity's `cek`. Without that step
the creator would lose the list on logging out: their list keys would only exist
in that browser. Logging in replays the identity log and the keys come back.

**Inviting**

`chelonia/out/keyAdd` puts a key named `#inviteKey-<id>` on the list, with the
single permission `OP_KEY_REQUEST` and a `quantity` and `expires`. Chelonia
tracks how many times it has been used and refuses it when it is spent. Its
secret goes in the fragment of the invite URL, after the `#`, which browsers
never send to the server.

**Joining**

`chelonia/out/keyRequest`, signed with the invite key. It writes two messages:
a reply key onto the joiner's identity contract, and `OP_KEY_REQUEST` onto the
list. The list ID is recorded in the joiner's `lists` slot straight away, so a
reload does not lose it.

**Answering**

Chelonia does this part by itself. When the list owner's client processes the
`OP_KEY_REQUEST` it queues `chelonia/private/respondToAllKeyRequests`, which
replies with every key marked `shareable`, addressed to the joiner's identity
contract. Nothing in this app is involved, and nothing on the relay can stand in
for it: **the owner has to be online with the app open.** Until they are, the
request sits on the contract and the joiner sees the list waiting.

When the keys land, Chelonia marks the list contract dirty and re-syncs it. That
drops and re-adds the subscription, `match` runs again, and the todos slot
attaches. From then on both accounts are writing the same slot on the same
contract, and converge exactly the way two windows of one account do.

Sharing the list's `#sak` is what lets the other account read and write
`/kv/<list>/todos` at all. It reaches no further than that list: deleting a
contract is checked against the account that pays for it, which stays the
creator.

**If you made an account before lists existed**, its todos were a slot on the
identity contract and this version does not look there. The account, the
username and the password still work; the old todos do not appear. There is no
migration, since nothing has shipped.

[Group Income](https://github.com/okTurtles/group-income) does the same thing
through a service worker, an encrypted settings database and a Vuex login
event. None of that is needed for one tab and one contract.
