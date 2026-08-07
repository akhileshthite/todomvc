import { KV_NOOP } from '@chelonia/lib/kv-constants'

export const MAX_TITLE_LENGTH = 512

// A slot schema is any object with a synchronous `parse(value)`; Zod also fits.
// Chelonia runs it on our writes, on values pushed by other clients and on
// load, so a buggy client cannot break the others.
//
// `null` and `undefined` are rejected anywhere in the value. Chelonia writes
// `null` on the wire to clear a key and uses `undefined` for "not loaded", so
// optional fields have to be modelled by leaving them out.
export const todosSchema = {
  parse (value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new TypeError('todos must be an object keyed by id')
    }
    const parsed = {}
    for (const [id, todo] of Object.entries(value)) {
      if (typeof todo !== 'object' || todo === null || Array.isArray(todo)) {
        throw new TypeError(`todo ${id} must be an object`)
      }
      const { title, completed, createdDate } = todo
      if (typeof title !== 'string' || title.length === 0 || title.length > MAX_TITLE_LENGTH) {
        throw new TypeError(`todo ${id} has an invalid title`)
      }
      if (typeof completed !== 'boolean') {
        throw new TypeError(`todo ${id} has an invalid completed flag`)
      }
      if (typeof createdDate !== 'string' || Number.isNaN(Date.parse(createdDate))) {
        throw new TypeError(`todo ${id} has an invalid createdDate`)
      }
      parsed[id] = { title, completed, createdDate }
    }
    return parsed
  }
}

// Every write is one of these. Chelonia re-runs them against the server's copy
// when someone else wrote first, so two tabs converge without any conflict
// handling here. KV_NOOP cancels the write.

export const addTodo = ({ id, title, createdDate }) => (prev) => ({
  ...prev,
  [id]: { title, completed: false, createdDate }
})

export const setCompleted = (id, completed) => (prev) => {
  if (!prev[id] || prev[id].completed === completed) return KV_NOOP
  return { ...prev, [id]: { ...prev[id], completed } }
}

export const setTitle = (id, title) => (prev) => {
  if (!prev[id] || prev[id].title === title) return KV_NOOP
  return { ...prev, [id]: { ...prev[id], title } }
}

export const removeTodo = (id) => (prev) => {
  if (!prev[id]) return KV_NOOP
  const { [id]: _removed, ...rest } = prev
  return rest
}

export const setAllCompleted = (completed) => (prev) => {
  const ids = Object.keys(prev).filter((id) => prev[id].completed !== completed)
  if (ids.length === 0) return KV_NOOP
  const next = { ...prev }
  for (const id of ids) next[id] = { ...next[id], completed }
  return next
}

export const removeCompleted = () => (prev) => {
  const entries = Object.entries(prev).filter(([, todo]) => !todo.completed)
  if (entries.length === Object.keys(prev).length) return KV_NOOP
  return Object.fromEntries(entries)
}

// The slot value is a plain object, so order is not something to rely on.
export const sortedTodos = (todos) =>
  Object.entries(todos)
    .map(([id, todo]) => ({ id, ...todo }))
    .sort((a, b) => a.createdDate.localeCompare(b.createdDate) || a.id.localeCompare(b.id))
