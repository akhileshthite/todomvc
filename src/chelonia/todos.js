import sbp from '@sbp/sbp'
import { CHELONIA_KV_VALIDATION_ERROR } from '@chelonia/lib/events'
import { KV_NOOP } from '@chelonia/lib/kv-constants'
import { LIST_CONTRACT_NAME } from './config.js'
import { connection } from './connection.js'
import { currentLists } from './lists.js'
import { pendingWrites, queueWrite } from './offline.js'
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

// Reducers by name, because a queued write is stored as JSON and cannot carry
// a function.
const OPS = { addTodo, setCompleted, setTitle, removeTodo, setAllCompleted, removeCompleted }

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

  sbp('sbp/selectors/register', {
    'todomvc/todos/write': (contractID, op, ...args) => sbp('chelonia/kv/update', {
      contractID,
      key: TODOS_KEY,
      updater: OPS[op](...args)
    })
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
//
// Writes still waiting for the server are applied on top, in the order they
// were made, so the list looks the same offline as it will once they land.
export function currentTodos (contractID) {
  const entry = mirrorEntry(contractID)
  if (!entry) return NO_TODOS
  const saved = entry.value ?? sbp('chelonia/kv/read', contractID, TODOS_KEY)
  return pendingWrites()
    .filter((w) => w.contractID === contractID)
    .reduce((todos, w) => {
      const next = OPS[w.op](...w.args)(todos)
      return next === KV_NOOP ? todos : next
    }, saved)
}

// 'non-init' | 'loading' | 'loaded' | 'error'
export function todosStatus (contractID) {
  return mirrorEntry(contractID)?.status ?? 'non-init'
}

export const pendingCount = (contractID) =>
  pendingWrites().filter((w) => w.contractID === contractID).length

const mirrorEntry = (contractID) => contractID && state._kv?.[contractID]?.[TODOS_KEY]

// Goes straight to the server when it is there. Otherwise, or when the request
// fails before an answer, the write is queued and sent later.
async function write (contractID, op, ...args) {
  const invocation = ['todomvc/todos/write', contractID, op, ...args]
  if (!connection.online) return queueWrite(invocation, { contractID, op, args })
  try {
    await sbp(...invocation)
  } catch (e) {
    // fetch rejects with a TypeError when the server never answered.
    if (!(e instanceof TypeError)) throw e
    queueWrite(invocation, { contractID, op, args })
  }
}

// Not crypto.randomUUID: that needs a secure context, and opening the demo
// from another machine on http://192.168.x.x is not one.
const newId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, '0')).join('')

export const createTodo = (contractID, title) => write(contractID, 'addTodo', {
  id: newId(),
  // Server time, so a tab with a wrong clock sorts the same as everyone else.
  createdDate: new Date(sbp('chelonia/time')).toISOString(),
  title
})

export const setTodoCompleted = (contractID, id, completed) =>
  write(contractID, 'setCompleted', id, completed)
export const renameTodo = (contractID, id, title) => write(contractID, 'setTitle', id, title)
export const destroyTodo = (contractID, id) => write(contractID, 'removeTodo', id)
export const completeAllTodos = (contractID, completed) =>
  write(contractID, 'setAllCompleted', completed)
export const clearCompletedTodos = (contractID) => write(contractID, 'removeCompleted')
