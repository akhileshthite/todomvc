# TodoMVC on Chelonia

This is the classic TodoMVC app, rebuilt on Chelonia so that it is end-to-end
encrypted. Your todos live on a server that cannot read them, two browser
windows on the same account stay in sync without a line of sync code in the
UI, and you can share a list with another account without the server ever
getting the means to read it.

It is deliberately small, meant to be read as much as run. If Chelonia is new
to you, start here and move on to the
[library docs](https://github.com/okTurtles/libcheloniajs/tree/main/docs) when
you want the details.

## Running it

Node 22 or newer.

```bash
npm install
npm start
```

Then open <http://localhost:8000/app/>. `npm start` builds the contracts and
the app and starts the server. `npm test` runs the unit tests and
`npm run test:e2e` runs Playwright against a server of its own. The other
scripts, and the files the first run creates, are listed in
[AGENTS.md](AGENTS.md).

## What to try

1. Create an account. The keys are generated in the browser; the server only
   ever sees a blinded hash of the password.
2. Add some todos, complete a few, double click one to edit it.
3. Open a second window on the same URL. It follows along.
4. Type in both windows at once. Both end up with the same list.
5. Reload. The session comes back.
6. Log out and log in again. Nothing local is reused, the keys come back out
   of the contract.
7. Share a list: press **Share**, open the link in a private window, sign up
   there and join. Keep the first window open, it is the one that answers.
8. Change your password from the **account** link at the bottom, then log out
   and in with the new one. The same panel deletes the account, along with
   the lists it created.
9. Stop the server with Ctrl-C and keep adding todos. They show up straight
   away and wait; start the server again and they go through.
10. Look at what the server actually has:

   ```bash
   chel eventsAfter <contract-id> 0
   ```

   `chel` is the `@chelonia/cli` command. The payload is encrypted; pass
   `--keys` with a dump of `secretKeys` from the saved state to read it.

## How it is built

- **Two contracts.** The **identity contract** is the account: registering it
  claims the username, and everything else is unlocked from it. A **list
  contract** is one todo list. A list is its own contract so that sharing it
  does not mean sharing the account: the server checks access to a contract's
  store per contract, so if the todos sat on the identity contract, letting
  someone into them would mean letting them into the whole account.
- **Todos are a KV slot, the title is an action.** Both on the list contract.
  Todo items change all the time and we do not want every version of them,
  while a rename is something everyone sharing the list should be able to see
  a record of. Rule of thumb: actions when history, ordering and multi-party
  validation matter, KV slots when only the latest value matters.
- **Every write is a reducer.** If someone else wrote first, the server rejects
  the write and Chelonia re-runs the reducer on the newer value. That is why
  two windows converge with no conflict code in the app. Reads never go to the
  network: Chelonia keeps a local copy of the slot, and because that copy sits
  in a Vue `reactive()` object the list redraws by itself.
  [docs/data.md](docs/data.md) walks through the slot declaration and the
  writes.
- **Keys.** Contracts have cryptographic keys, used to sign and to encrypt
  data. How they are used is up to the app. In TodoMVC each contract has
  three: `csk` signs what the contract writes, `cek` encrypts the payload, and
  `#sak` is what the server checks before it serves that contract's KV store.
  The account has two more, `ipk` and `iek`, derived from the password and
  never stored.
- **Login.** The password never leaves the browser. Signup sends a blinded
  hash and gets a salt back; from the password and the salt the browser
  derives the two secrets it needs to create the account and to lock the
  everyday keys inside it, then forgets them. Logging in on another machine
  derives them again, syncs the contract and unlocks the keys out of it. Step
  by step in [docs/login.md](docs/login.md).
- **Sharing.** The owner makes an invite link, whoever opens it asks the list
  for access, and the owner's browser answers by sending over the keys,
  encrypted so that only that account can open them. The server cannot do this
  part, so the owner has to be online with the app open until the request is
  answered. Message by message in [docs/sharing.md](docs/sharing.md).
- **The saved session** is plain JSON in `localStorage`, secret keys included.
  Fine for a local demo, wrong for anything real.

## What Chelonia is

[Shelter Protocol](https://shelterprotocol.net/) is a protocol for end-to-end
encrypted apps: the server holds the data, only the users can read it. Chelonia
is its JavaScript implementation.
[`@chelonia/lib`](https://www.npmjs.com/package/@chelonia/lib) is the client
library and [`@chelonia/cli`](https://www.npmjs.com/package/@chelonia/cli) (the
`chel` command) is the tooling and the server. The Chelonia server is the relay
between the clients: it stores the messages, forwards them to whoever is
subscribed, and checks the chain, the signatures and the key permissions. It
cannot read the encrypted payloads, and your app's logic runs on the clients,
not there.

A few terms used above and in the code:

- **Contract.** An append-only log of signed messages with a contract ID, plus
  the `validate` and `process` code every client runs over the log to build the
  state. The rules live on the client, so the server never has to be trusted
  with them.
- **Action.** One message appended to a contract, usually encrypted.
- **Contract manifest.** A signed file pointing at a contract's source. Clients
  fetch it, check the signature and evaluate the source in a sandbox, which is
  why the contracts in this repo are not bundled with the app.
- **KV store.** A per-contract key/value store, last write wins, signed and
  encrypted like everything else. A **slot** is a typed declaration of one key,
  and the library handles fetching, caching, live updates and write conflicts
  for it. "Key" here is the name a value is stored under, not a cryptographic
  key.

Everything is called through [`sbp`](https://github.com/okTurtles/sbp-js), so
calls look like `sbp('chelonia/kv/update', { ... })`.
