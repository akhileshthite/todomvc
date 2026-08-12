// The identity contract.
//
// Not bundled with the app. chel signs it and Chelonia fetches it and evaluates
// it in a sandbox where `sbp` is a global, so there are no imports here.
//
// It is almost empty on purpose. Todos live in a KV slot, not in actions. What
// the contract provides is what KV cannot: an object on the server that owns
// the keys and gives `/kv/:contractID/:key` its scope.
//
// The name has to be `gi.contracts/identity`. chel's POST /event only accepts a
// contract created without an account to bill it to when the manifest name is
// that, and only registers a username for a contract of that type. See
// src/serve/routes.ts in okTurtles/chel.

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
      },
      process ({ data }, { state }) {
        state.attributes = { ...data.attributes }
      }
    }
  }
})
