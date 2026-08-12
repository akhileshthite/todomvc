import sbp from '@sbp/sbp'
import { reactive, watch } from 'vue'

const STORAGE_KEY = 'todomvc/chelonia-state'

function loadSaved () {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved ? JSON.parse(saved) : null
  } catch (e) {
    console.warn('[todomvc] ignoring unreadable saved state', e)
    return null
  }
}

// Chelonia's root state: contract states, secret keys, the KV mirror at `_kv`,
// and one field of our own, `loggedIn`.
//
// Vue 3 tracks a `reactive()` object through a Proxy, so the default
// reactiveSet and reactiveDel in chelonia/configure are correct. Chelonia
// writes the KV mirror into this object, which is what lets the UI update from
// a computed instead of a subscription.
export const state = reactive(loadSaved() ?? { contracts: {} })

sbp('sbp/selectors/register', {
  'todomvc/state': () => state
})

let stopWatching = null

// Saving the whole state on every change is fine at this size. An app with
// large contracts would debounce this or use IndexedDB.
export function persistState () {
  stopWatching?.()
  stopWatching = watch(state, () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch (e) {
      console.error('[todomvc] could not save state', e)
    }
  }, { deep: true, flush: 'post' })
}

// Stops saving as well as clearing. The watcher runs after the current render,
// so leaving it on would write the state straight back.
export function clearSavedState () {
  stopWatching?.()
  stopWatching = null
  localStorage.removeItem(STORAGE_KEY)
}
