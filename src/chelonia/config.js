import sbp from '@sbp/sbp'
import '@chelonia/lib'
import manifests from '../contracts/manifests.json'
import './state.js'

// This is Group Income's identity contract name, but the contract is our own,
// in src/contracts/identity.js. chel only lets a contract with this exact name
// be created without an account to bill it to, and only registers a username
// for that type, so an app with its own signup has no choice yet.
// TODO: rename once okTurtles/chel#160 lands.
export const CONTRACT_NAME = 'gi.contracts/identity'

// The same chel serve process answers /event, /name, /kv and the pubsub socket.
export const API_URL = window.location.origin

export async function configureChelonia () {
  await sbp('chelonia/configure', {
    connectionURL: API_URL,
    stateSelector: 'todomvc/state',
    contracts: {
      // manifests.json is written by `npm run contracts`. Chelonia refuses to
      // load a contract whose manifest CID is not listed here.
      ...manifests,
      defaults: {
        // The contract calls no selectors, so nothing needs allowing through.
        allowedSelectors: [],
        allowedDomains: [],
        preferSlim: false
      }
    }
  })

  // configure does not open the socket. Without this, writes still reach the
  // server but nothing comes back: no contract events, no KV updates.
  sbp('chelonia/connect')
}
