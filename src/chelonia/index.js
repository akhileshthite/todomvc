import { configureChelonia } from './config.js'
import { watchConnection } from './connection.js'
import { persistState } from './state.js'
import { restoreSession } from './auth.js'
import { defineListsSlot } from './lists.js'
import { setupOfflineQueue } from './offline.js'
import { defineTodosSlot } from './todos.js'

export async function startChelonia () {
  watchConnection()
  await configureChelonia()
  setupOfflineQueue()
  defineListsSlot()
  defineTodosSlot()
  persistState()
  return restoreSession()
}

export {
  AuthError, changePassword, currentUsername, deleteAccount, login, logout, signup
} from './auth.js'
export { connection } from './connection.js'
export { state } from './state.js'
