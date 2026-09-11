import sbp from '@sbp/sbp'
import { reactive } from 'vue'
import {
  PUBSUB_RECONNECTION_ATTEMPT,
  PUBSUB_RECONNECTION_FAILED,
  PUBSUB_RECONNECTION_SCHEDULED,
  PUBSUB_RECONNECTION_SUCCEEDED
} from '@chelonia/lib/pubsub'
import { retryPendingWrites } from './offline.js'

// The socket is the only thing that says the server went away mid-session.
// Reads keep working off the mirror, so without this the app would not know
// to queue writes instead of sending them.
export const connection = reactive({ online: true })

export function watchConnection () {
  const lost = () => { connection.online = false }

  // Emitted when the socket closes and a retry is queued, on each retry, and
  // when the retries run out.
  sbp('okTurtles.events/on', PUBSUB_RECONNECTION_SCHEDULED, lost)
  sbp('okTurtles.events/on', PUBSUB_RECONNECTION_ATTEMPT, lost)
  sbp('okTurtles.events/on', PUBSUB_RECONNECTION_FAILED, lost)
  // Also fires on the first open, not just on a reconnect.
  sbp('okTurtles.events/on', PUBSUB_RECONNECTION_SUCCEEDED, () => {
    connection.online = true
    retryPendingWrites()
  })
}
