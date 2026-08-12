import sbp from '@sbp/sbp'
import { CONTRACT_NAME } from './config.js'
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
    contractType: CONTRACT_NAME,
    key: TODOS_KEY,
    defaultValue: {},
    schema: todosSchema,
    // For completeness only. We could omit this since there is a single
    // contract. It is also why login and logout call refreshFilters.
    match: (contractID) => contractID === state.loggedIn?.identityContractID
  })
}

function currentContractID () {
  const identityContractID = state.loggedIn?.identityContractID
  if (!identityContractID) throw new Error('Not logged in')
  return identityContractID
}

// Reading `entry.value` is what makes a Vue computed re-run when Chelonia
// updates the mirror. The value itself comes from the selector, which
// substitutes the declared default. See "Consumer caveats" in docs/kv.md.
export function currentTodos () {
  const entry = mirrorEntry()
  if (!entry) return NO_TODOS
  return entry.value ?? sbp('chelonia/kv/read', currentContractID(), TODOS_KEY)
}

// 'non-init' | 'loading' | 'loaded' | 'error'
export function todosStatus () {
  return mirrorEntry()?.status ?? 'non-init'
}

function mirrorEntry () {
  const identityContractID = state.loggedIn?.identityContractID
  return identityContractID && state._kv?.[identityContractID]?.[TODOS_KEY]
}

const write = (updater) => sbp('chelonia/kv/update', {
  contractID: currentContractID(),
  key: TODOS_KEY,
  updater
})

// Not crypto.randomUUID: that needs a secure context, and opening the demo
// from another machine on http://192.168.x.x is not one.
const newId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, '0')).join('')

export const create = (title) => write(addTodo({
  id: newId(),
  // Server time, so a tab with a wrong clock sorts the same as everyone else.
  createdDate: new Date(sbp('chelonia/time')).toISOString(),
  title
}))

export const complete = (id, completed) => write(setCompleted(id, completed))
export const rename = (id, title) => write(setTitle(id, title))
export const destroy = (id) => write(removeTodo(id))
export const completeAll = (completed) => write(setAllCompleted(completed))
export const clearCompleted = () => write(removeCompleted())
