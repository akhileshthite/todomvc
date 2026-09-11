// Writes made while the server is unreachable.
//
// They go into Chelonia's persistent action queue, which retries them until
// the server takes them, and until then they are shown on top of the last
// value the server sent. The queue keeps `[selector, ...args]` as plain JSON,
// so a write is described by name and its reducer is looked up when it runs.

import sbp from '@sbp/sbp'
import {
  PERSISTENT_ACTION_SUCCESS,
  PERSISTENT_ACTION_TOTAL_FAILURE
} from '@chelonia/lib/events'
import { state } from './state.js'

const QUEUE_KEY = 'todomvc/pending-writes'
const NO_WRITES = Object.freeze([])

export const pendingWrites = () => state.pendingWrites ?? NO_WRITES

export function setupOfflineQueue () {
  keepQueueInLocalStorage()
  sbp('chelonia.persistentActions/configure', {
    databaseKey: QUEUE_KEY,
    options: { retrySeconds: 15 }
  })
  const forget = ({ id }) => {
    state.pendingWrites = pendingWrites().filter((w) => w.id !== id)
  }
  sbp('okTurtles.events/on', PERSISTENT_ACTION_SUCCESS, forget)
  sbp('okTurtles.events/on', PERSISTENT_ACTION_TOTAL_FAILURE, ({ id, error }) => {
    console.error('[todomvc] gave up on a queued write', error)
    forget({ id })
  })
}

// chelonia.db is an in-memory map in this app, and the queue has to outlive a
// reload, so this one key goes to localStorage instead.
function keepQueueInLocalStorage () {
  const get = sbp('sbp/selectors/fn', 'chelonia.db/get')
  const set = sbp('sbp/selectors/fn', 'chelonia.db/set')
  // Both return a promise, as the originals do and as their callers expect.
  sbp('sbp/selectors/overwrite', {
    'chelonia.db/get': async (key) =>
      key === QUEUE_KEY ? localStorage.getItem(QUEUE_KEY) : get(key),
    'chelonia.db/set': async (key, value) =>
      key === QUEUE_KEY ? localStorage.setItem(QUEUE_KEY, value) : set(key, value)
  })
  sbp('sbp/selectors/lock', ['chelonia.db/get', 'chelonia.db/set'])
}

// Called once a session is open. Writes for lists this account is not in
// (another account used this browser and never logged out) are dropped.
export async function loadOfflineQueue (isOurs) {
  await sbp('chelonia.persistentActions/load')
  const queued = sbp('chelonia.persistentActions/status')
  for (const action of queued) {
    if (!isOurs(action.invocation[1])) await sbp('chelonia.persistentActions/cancel', action.id)
  }
  const kept = new Set(sbp('chelonia.persistentActions/status').map((a) => a.id))
  state.pendingWrites = pendingWrites().filter((w) => kept.has(w.id))
}

export function queueWrite (invocation, write) {
  const [id] = sbp('chelonia.persistentActions/enqueue', invocation)
  state.pendingWrites = [...pendingWrites(), { id, ...write }]
}

export const retryPendingWrites = () => sbp('chelonia.persistentActions/retryAll')

export async function dropPendingWrites () {
  for (const { id } of sbp('chelonia.persistentActions/status')) {
    await sbp('chelonia.persistentActions/cancel', id)
  }
  state.pendingWrites = []
}
