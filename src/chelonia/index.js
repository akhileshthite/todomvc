import { configureChelonia } from './config.js'
import { persistState } from './state.js'
import { restoreSession } from './auth.js'
import { defineTodosSlot } from './todos.js'

// The slot has to be declared before any contract syncs, or its first load is
// missed and nothing arrives until the next write.
export async function startChelonia () {
  await configureChelonia()
  defineTodosSlot()
  persistState()
  return restoreSession()
}

export { AuthError, currentUsername, login, logout, signup } from './auth.js'
export { state } from './state.js'
