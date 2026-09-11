# Signup and login, step by step

This is for someone reading `src/chelonia/auth.js`. The README explains what
happens without any of this; start there if you have not.

Two more key names appear here, next to the three from
[sharing.md](sharing.md). Both are derived from the password and neither is
ever stored:

| name | what it does |
| --- | --- |
| `ipk` | signs the message that creates the account |
| `iek` | encrypts the account's other secrets inside the contract, so logging in on a new machine can open them |

## Signup

1. Register a salt against `/zkpp/register/:username`. The server gets a blinded
   hash, never the password, and returns a salt plus a one-time token.
2. Derive `ipk` and `iek` from the password and that salt.
3. Generate the everyday keys, `csk`, `cek` and `#sak`. Their secret halves go
   into the contract encrypted to the `iek`.
4. `chelonia/out/registerContract`, signed by the `ipk`, with the username in
   the `shelter-namespace-registration` header and the token in
   `shelter-salt-registration-token`.
5. Keep `csk`, `cek` and `#sak`. Discard `ipk` and `iek`.
6. Create the account's first list. See [sharing.md](sharing.md).

## Login

1. `GET /name/:username` gives the contract ID.
2. Prove the password against `/zkpp/:contractID/auth_hash` and
   `/contract_hash`, which returns the same salt as at signup.
3. Derive the `iek` and hand it to Chelonia as a transient key.
4. `chelonia/contract/retain`. Syncing the contract decrypts `csk`, `cek` and
   `#sak` with the `iek` and stores them. That is the whole recovery.
5. Discard the `iek`.
6. Load the `lists` slot and open each list in it.

A wrong password comes back from the server as a 500, not as a clean failure, so
the app tells a bad password apart from a connection problem by whether the
server answered at all.

## Reload

None of the above. The secrets and the contract state are already in the saved
blob, so it only re-syncs.

## Changing the password

1. Prove the current password against `/zkpp/:contractID/auth_hash`, as at
   login.
2. `POST /zkpp/:contractID/updatePasswordHash` with that proof and the new
   password's hash, encrypted to the proof's shared secret
   (`buildUpdateSaltRequestEc`). The answer is the old contract salt and a
   one-time token.
3. Derive the old `ipk` and `iek` from the old password and salt, and the new
   ones from the new password and the new salt.
4. `chelonia/out/keyUpdate`, signed by the old `ipk`, with the token in the
   `shelter-salt-update-token` header. `ipk` and `iek` are replaced. `csk`,
   `cek` and `#sak` keep their keys and only get their secrets encrypted again
   to the new `iek`, so nothing already on the contract has to be rewritten.
5. Publish the deletion token again, encrypted to the new `iek`.
6. Discard all four password keys.

## Deleting the account

Signup sends `shelter-deletion-token-digest`, the hash of a random token, and
keeps the token itself in the contract encrypted to the `iek`. So deleting
takes the password.

1. Prove the password and derive the `iek`, as at login.
2. Decrypt the token out of `attributes.encryptedDeletionToken`.
3. `chelonia/out/deleteContract` with the token. The server answers 202 and
   deletes the contract in the background, together with every list this
   account created. Lists joined through an invite belong to whoever made them
   and stay.
4. Log out locally.

The username is not freed. chel 3.4.0 keeps the name pointing at the deleted
contract and only lists it as orphaned, so signing up with the same name again
is refused as taken until the server cleans those up.
