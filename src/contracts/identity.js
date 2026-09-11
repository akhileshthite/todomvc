// The identity contract.
//
// Not bundled with the app. chel signs it and Chelonia fetches it and evaluates
// it in a sandbox where `sbp` is a global, so there are no imports here.
//
// It is almost empty on purpose. Todos live in a KV slot, not in actions. What
// the contract provides is what KV cannot: an object on the server that owns
// the keys and gives `/kv/:contractID/:key` its scope.
//
// TODO: BEGIN REMOVEME (okTurtles/chel#160)
// The name has to be `gi.contracts/identity`, here and on the actions below.
// chel's POST /event only accepts a contract created without an account to
// bill it to when the manifest name is that, and only registers a username for
// a contract of that type. See src/serve/routes.ts in okTurtles/chel.
// TODO: END REMOVEME (okTurtles/chel#160)

// Encrypted data on the wire is a `[keyId, ciphertext]` pair.
const isEncrypted = (v) => Array.isArray(v) && v.length === 2 && v.every((s) => typeof s === 'string')

sbp('chelonia/defineContract', {
  name: 'gi.contracts/identity',
  actions: {
    // The initial action, published with OP_CONTRACT by
    // chelonia/out/registerContract. Its name is the contract name.
    'gi.contracts/identity': {
      validate (data) {
        if (typeof data?.attributes?.username !== 'string') {
          throw new TypeError('attributes.username must be a string')
        }
        // Lets the account delete itself later. Accounts made before it
        // existed do not have one.
        const token = data.attributes.encryptedDeletionToken
        if (token !== undefined && !isEncrypted(token)) {
          throw new TypeError('attributes.encryptedDeletionToken must be encrypted data')
        }
      },
      process ({ data }, { state }) {
        state.attributes = { ...data.attributes }
      }
    },
    // The token is encrypted to the key the password derives, so a password
    // change publishes it again under the new one.
    'gi.contracts/identity/setDeletionToken': {
      validate (data) {
        if (!isEncrypted(data?.encryptedDeletionToken)) {
          throw new TypeError('encryptedDeletionToken must be encrypted data')
        }
      },
      process ({ data }, { state }) {
        state.attributes.encryptedDeletionToken = data.encryptedDeletionToken
      }
    }
  }
})
