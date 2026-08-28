import sbp from '@sbp/sbp'
import { CHELONIA_KV_VALIDATION_ERROR } from '@chelonia/lib/events'
import { LIST_CONTRACT_NAME } from './config.js'
import { currentLists } from './lists.js'
import { state } from './state.js'
import {
  addTodo,
  removeCompleted,
  removeTodo,
  setAllCompleted,
  setCompleted,
  setTitle,
  todosSchema
} from './todos-model.js'

const TODOS_KEY = 'todos'
const NO_TODOS = Object.freeze({})

// One declaration covers the first fetch, the pubsub subscription, the local
// mirror, schema validation and the conflict retries.
export function defineTodosSlot () {
  sbp('chelonia/kv/defineSlot', {
    contractType: LIST_CONTRACT_NAME,
    key: TODOS_KEY,
    defaultValue: {},
    schema: todosSchema,
    // Attaches to every list this account is in, but only once we hold that
    // list's keys. Between accepting an invite and the owner answering it there
    // is nothing here we could read or write: /kv/:contractID/:key is
    // authorized with the contract's own #sak.
    //
    // Nothing re-runs this by hand when the keys finally arrive. Chelonia marks
    // the contract dirty on OP_KEY_SHARE and resyncs it, and a resync drops and
    // re-adds the subscription, which is what reconciles the slots again.
    match: (contractID, contractState) =>
      currentLists().includes(contractID) &&
      !!sbp('chelonia/contract/currentKeyIdByName', contractState, '#sak', true)
  })

  // A value that fails the schema never reaches the app: the mirror keeps the
  // last good one and the slot goes to 'error'. The UI reads that status; this
  // is here so the reason is visible while developing.
  sbp('okTurtles.events/on', CHELONIA_KV_VALIDATION_ERROR, ({ key, reason, error }) => {
    if (key !== TODOS_KEY) return
    console.error(`[todomvc] rejected a ${reason} value for '${key}'`, error)
  })
}

// Reading `entry.value` is what makes a Vue computed re-run when Chelonia
// updates the mirror. The value itself comes from the selector, which
// substitutes the declared default. See "Consumer caveats" in docs/kv.md.
export function currentTodos (contractID) {
  const entry = mirrorEntry(contractID)
  if (!entry) return NO_TODOS
  return entry.value ?? sbp('chelonia/kv/read', contractID, TODOS_KEY)
}

// 'non-init' | 'loading' | 'loaded' | 'error'
export function todosStatus (contractID) {
  return mirrorEntry(contractID)?.status ?? 'non-init'
}

const mirrorEntry = (contractID) => contractID && state._kv?.[contractID]?.[TODOS_KEY]

const write = (contractID, updater) => sbp('chelonia/kv/update', {
  contractID,
  key: TODOS_KEY,
  updater
})

// Not crypto.randomUUID: that needs a secure context, and opening the demo
// from another machine on http://192.168.x.x is not one.
const newId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, '0')).join('')

export const create = (contractID, title) => write(contractID, addTodo({
  id: newId(),
  // Server time, so a tab with a wrong clock sorts the same as everyone else.
  createdDate: new Date(sbp('chelonia/time')).toISOString(),
  title
}))

export const complete = (contractID, id, completed) =>
  write(contractID, setCompleted(id, completed))
export const rename = (contractID, id, title) => write(contractID, setTitle(id, title))
export const destroy = (contractID, id) => write(contractID, removeTodo(id))
export const completeAll = (contractID, completed) =>
  write(contractID, setAllCompleted(completed))
export const clearCompleted = (contractID) => write(contractID, removeCompleted())
