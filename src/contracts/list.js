// A todo list.
//
// Like the identity contract this is almost empty, and for the same reason: the
// todos live in a KV slot, and what the contract provides is the thing KV
// cannot, an object on the server that owns keys and scopes
// `/kv/:contractID/:key`.
//
// The difference is who can read it. This contract's keys can be shared with
// another account through an invite, so two people end up writing the same
// slot.
//
// The name is free here, unlike the identity contract. A list is created by an
// identity, so the message is attributed and never reaches chel's
// unattributed-first-message path.

// Same cap as the todos, in MAX_TITLE_LENGTH. Contracts run in a sandbox with
// no imports, so it is repeated rather than shared.
const MAX_TITLE_LENGTH = 512

const assertTitle = (title) => {
  if (typeof title !== 'string' || !title || title.length > MAX_TITLE_LENGTH) {
    throw new TypeError(`title must be a string of 1 to ${MAX_TITLE_LENGTH} characters`)
  }
}

sbp('chelonia/defineContract', {
  name: 'todomvc/list',
  actions: {
    // Published with OP_CONTRACT by chelonia/out/registerContract.
    'todomvc/list': {
      validate (data) {
        assertTitle(data?.attributes?.title)
      },
      process ({ data }, { state }) {
        state.attributes = { ...data.attributes }
      }
    },
    'todomvc/list/rename': {
      validate (data) {
        assertTitle(data?.title)
      },
      process ({ data }, { state }) {
        state.attributes.title = data.title
      }
    }
  }
})
