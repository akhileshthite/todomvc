# TodoMVC on Chelonia

A todo list where the server stores your data but cannot read it, where two
browser windows stay in sync without any sync code in the UI, and where a list
can be shared with another account without the server ever having the means to
read it.

It is meant to be read as much as run. If you have never used Chelonia before,
start here and then go to the [library
docs](https://github.com/okTurtles/libcheloniajs/tree/main/docs).

## What Chelonia is

[Shelter Protocol](https://shelterprotocol.net/) is a protocol for apps where
the server holds the data but only the user can read it. Chelonia is its
JavaScript implementation: [`@chelonia/lib`](https://www.npmjs.com/package/@chelonia/lib)
is the client library and [`@chelonia/cli`](https://www.npmjs.com/package/@chelonia/cli)
(the `chel` command) is the tooling and the server.

Seven terms you need before reading the code.

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

**Cryptographic keys.** Every contract has a set of them. One signs what the
contract writes, so any client can check who wrote it. One encrypts the payload,
so the relay stores it without being able to read it. One is what the relay
checks before it will serve that contract's key/value store. Only the public
halves are on the relay. The secret halves stay in the browser, and a contract
can also carry its own secret halves inside itself, encrypted, which is how
logging in on a second machine works.

**Contract manifest.** A signed file pointing at a contract's source. Clients
fetch it, check the signature, then evaluate the source in a sandbox. That is
why the contracts in this repo are not bundled with the app. Chelonia has other
kinds of manifest, for files; this README only means this one.

**Giving another account access.** The relay cannot do it, because it never has
the means to read a contract in the first place. So access is granted between
browsers: a client that can read a contract sends the secret halves to the
account being let in, encrypted so that only that account can open them.

**KV store.** A per-contract key/value store at `/kv/:contractID/:key`, last
write wins, values signed and encrypted like everything else. For data where a
full log would be more than you need. A **slot** is a typed declaration of one
key; the library then handles fetching, caching, live updates and write
conflicts. The word "key" here is the name a value is filed under, not a
cryptographic key. Both meanings are unavoidable, since both are Chelonia's own
terms, so this README always says which one it means.

Everything is called through [`sbp`](https://github.com/okTurtles/sbp-js), a
selector-based dispatcher, so calls look like
`sbp('chelonia/kv/update', { ... })` rather than method calls on an object.

## Why a contract and why a KV slot

This app uses both, and choosing between them is the main lesson.

There are two contracts. The **identity contract** is the account: registering
it claims the username, and everything else is unlocked from it. A **list
contract** is one todo list.

A list is its own contract so that sharing one does not mean sharing the
account. The relay decides who may read and write a store per contract, so if
the todos lived on the identity contract, letting a second account near them
would let it near everything else on that account too.

The **todos** of a list are one KV slot on the list contract, and the **title**
is an action on it. The split is about history: todo items change constantly and
we do not want to keep every version of them, while a rename is something all
the accounts sharing the list should be able to see a record of.

The tradeoff is that a slot only keeps the latest value. Nothing tells you who
changed a todo or when, and if two clients write at once one reducer is re-run
against the other's result. An append-only log gives you all of that, at the
cost of a message per keystroke.

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
| `npm run contracts` | signs, versions and pins the contracts, writes their manifest CIDs for the app |
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

1. Create an account. The account's secret keys are generated in the browser
   and the relay only ever sees a blinded hash of the password.
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
docs/login.md               signup and login, step by step
docs/sharing.md             how sharing works, message by message
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
until its keys arrive there is nothing you could read or write. That is the
`#sak` from the glossary: the relay checks it before serving
`/kv/:contractID/:key`.

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

The password never leaves the browser. Signing up sends the relay a blinded hash
of it and gets back a salt; from the password and that salt the browser derives
two secrets, uses them to create the account contract and to lock the account's
everyday secrets inside it, then throws them away.

Logging in on another machine derives the same two secrets again, syncs the
contract, and unlocks the everyday secrets out of it. Nothing local is needed,
which is what the "log out, log in" step in **What to try** shows.

Reloading does none of that: the secrets and the contract state are already in
the saved blob, so it only re-syncs.

The endpoints and the key names are in [docs/login.md](docs/login.md), and the
code is in `src/chelonia/auth.js`.

That blob is plain JSON in `localStorage`, secret keys included. Fine for a
local demo, wrong for anything real. Group Income keeps the same state in an
encrypted settings database.

### Sharing a list

Any account can let another account into one of its lists. The relay cannot do
this, and cannot read the list either way, so the two browsers arrange it
between themselves: the owner creates an invite link, whoever opens it asks the
list for access, and the owner's browser answers by sending over what is needed
to read and write it.

The catch is that the owner has to be online with the app open when the invite
is opened, or shortly after. Nothing on the server can answer in their place.
Until they do, the person joining sees the list sitting there waiting.

How that works message by message is in [docs/sharing.md](docs/sharing.md), and
the code is in `src/chelonia/lists.js`.

**If you made an account before lists existed**, its todos were a slot on the
identity contract and this version does not look there. The account, the
username and the password still work; the old todos do not appear. There is no
migration, since nothing has shipped.

[Group Income](https://github.com/okTurtles/group-income) does the same thing
through a service worker, an encrypted settings database and a Vuex login
event. None of that is needed for one tab and one contract.
