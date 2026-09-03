// A todo list. Almost empty for the same reason as the identity contract: the
// todos live in a KV slot, and the contract is what owns the keys and scopes
// `/kv/:contractID/:key`. An invite shares these keys, so two accounts write
// the same slot.
//
// The name is free here. A list is created by an identity, so it is attributed
// and never hits chel's unattributed-first-message path.

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
