# Sharing a list, message by message

This is for someone reading `src/chelonia/lists.js`. The README explains what
sharing does without any of this; start there if you have not.

Chelonia names three of a contract's cryptographic keys, and this document uses
those names because the code does. What they stand for is not written down
anywhere in Chelonia, so here is what each one is for:

| name | what it does |
| --- | --- |
| `csk` | signs what the contract writes, so any client can check who wrote it |
| `cek` | encrypts payloads, so the relay stores them without being able to read them |
| `#sak` | what the relay checks before it will serve `/kv/:contractID/:key` |

A fourth thing to know: a key stored inside a contract can carry a flag called
`shareable`. When someone asks a contract for access, Chelonia answers with the
keys carrying that flag and with nothing else. That is the whole of the access
rule.

## Creating a list

A list is a new contract, so it needs its own three keys and its own place on
the relay.

`chelonia/out/registerContract`, with `publishOptions.billableContractID` set to
the account's identity contract so the relay knows who pays for the new one.
Only an identity contract may be created without that.

Each of the list's three secrets is stored inside the list contract, encrypted
to the list's own `cek`, and marked `shareable`. Encrypting them all to one of
their own number is what makes handing the list over a single step: whoever
receives the `cek` can then read the other two out of the contract.

The same three secrets also go to the creator's *own* identity contract, with
`chelonia/out/keyShare`, encrypted to that identity's `cek`. Without this step
they would exist only in the browser that made the list, and logging out would
lose it. Logging in replays the identity log and they come back.

## Inviting

`chelonia/out/keyAdd` puts one more key on the list, named `#inviteKey-<id>`,
whose only permission is `OP_KEY_REQUEST`, plus a `quantity` and an `expires`.
The `#inviteKey-` prefix is what makes Chelonia count uses of it and refuse it
once it is spent.

Its secret goes in the fragment of the invite URL, after the `#`, which browsers
never send to the server. `inviteToList` reuses an unspent invite already on the
contract rather than minting a second one.

## Joining

`chelonia/out/keyRequest`, signed with the invite key. It writes two messages: a
reply key onto the joiner's identity contract, and `OP_KEY_REQUEST` onto the
list. `encryptKeyRequestMetadata: true` keeps the relay from seeing which two
contracts are being connected.

The list ID goes into the joiner's `lists` slot straight away, before any answer
arrives, so a reload does not lose it.

## Answering

Chelonia does this part on its own. The owner's client processes the
`OP_KEY_REQUEST` and queues `chelonia/private/respondToAllKeyRequests`, which
replies with every key marked `shareable`. No app code is involved.

The relay cannot stand in for the owner, so the owner has to be online with the
app open. Until then the request sits on the contract and the joiner sees the
list waiting.

When the secrets arrive, Chelonia marks the list contract dirty and re-syncs it.
A re-sync drops and re-adds the subscription, which is what makes the todos slot
re-run its `match` and attach. Both accounts then write the same slot and
converge the same way two windows of one account do.

## How far the access reaches

The shared `#sak` is what allows `/kv/<list>/todos` at all, and it reaches no
further than that list. Deleting a contract is checked against the account that
pays for it, which stays the creator.
