// Signup, login, logout and session restore.
//
// IPK and IEK are derived from the password and never stored. CSK, CEK and SAK
// are random, and their secret halves sit in the contract encrypted to the IEK.
// That is what makes login work on a machine that has never seen the account:
// deriving the IEK is enough for Chelonia to open them while it syncs.

import sbp from '@sbp/sbp'
import { Secret } from '@chelonia/lib/Secret'
import { encryptedOutgoingDataWithRawKey } from '@chelonia/lib/encryptedData'
import { bytesToB64 } from '@chelonia/lib/functions'
import {
  base64ToBase64url,
  boxKeyPair,
  buildRegisterSaltRequest,
  computeCAndHc,
  decryptContractSalt,
  hash,
  hashPassword,
  randomNonce
} from '@chelonia/lib/zkpp'
import {
  CURVE25519XSALSA20POLY1305,
  EDWARDS25519SHA512BATCH,
  deriveKeyFromPassword,
  keyId,
  keygen,
  serializeKey
} from '@chelonia/crypto'
import { API_URL, CONTRACT_NAME } from './config.js'
import { createList, loadLists, retainOrSync } from './lists.js'
import { clearSavedState, persistState, state } from './state.js'

const DEFAULT_LIST_TITLE = 'My todos'

export class AuthError extends Error {
  constructor (message, options) {
    super(message, options)
    this.name = 'AuthError'
    // Login turns most failures into "incorrect username or password". This
    // marks the ones whose message is already the right one.
    this.exact = !!options?.exact
  }
}

// Copied from NAME_REGEX in chel's src/serve/routes.ts. The relay rejects
// anything else with a 400, so check here first to give a usable message.
// Lowercase only, cannot start or end with - or _, and no repeated separator.
// TODO: drop this once a @chelonia/cli release makes the rule available
// instead of having to be copied.
const USERNAME_REGEX = /^(?![_-])((?!([_-])\2)[a-z\d_-]){1,80}(?<![_-])$/

function assertUsername (username) {
  if (!USERNAME_REGEX.test(username)) {
    throw new AuthError(
      'Usernames can use lowercase letters, numbers, hyphen and underscore, up ' +
      'to 80 characters. They cannot start or end with a hyphen or underscore, ' +
      'or use the same one twice in a row.'
    )
  }
}

// A rejected fetch means the request never got an answer. Any status, even a
// 500, means the server did answer.
async function send (path, init) {
  try {
    return await fetch(`${API_URL}${path}`, init)
  } catch (e) {
    throw new AuthError('Could not reach the server. Check your connection.', {
      cause: e, exact: true
    })
  }
}

async function request (path, init) {
  const response = await send(path, init)
  if (!response.ok) {
    throw new AuthError(`${init?.method ?? 'GET'} ${path} failed: ${response.status}`)
  }
  return response
}

const form = (fields) => ({
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(fields).toString()
})

// The zkpp helpers return raw bytes; the endpoints want base64url.
const toBase64url = (bytes) => base64ToBase64url(bytesToB64(bytes))

// Claims the username and returns the salt the keys are derived from, plus a
// token that proves the claim to POST /event. The server sees a blinded hash,
// never the password.
async function registerSalt (username, password) {
  const keyPair = boxKeyPair()
  const r = toBase64url(keyPair.publicKey)
  const path = `/zkpp/register/${encodeURIComponent(username)}`

  // This is where a taken username is caught: the relay looks the name up
  // before it will issue a registration key.
  const challenge = await send(path, form({ b: hash(r) }))
  if (challenge.status === 409) throw new AuthError('That username is already taken.')
  if (!challenge.ok) throw new AuthError(`Could not start signup: ${challenge.status}`)

  const { p, s, sig } = await challenge.json()
  const [contractSalt, Eh, encryptionKey] =
    await buildRegisterSaltRequest(p, keyPair.secretKey, password)
  const encryptedToken = await request(path, form({ r, s, sig, Eh })).then((r) => r.text())

  return [contractSalt, decryptContractSalt(encryptionKey, encryptedToken)]
}

// The other half: prove the password for an existing account and get the same
// salt back. The second element is the CID anchoring previously rotated keys,
// which only matters once an app supports password changes.
async function retrieveSalt (identityContractID, password) {
  const r = randomNonce()
  const contract = encodeURIComponent(identityContractID)

  const { authSalt, s, sig } = await request(
    `/zkpp/${contract}/auth_hash?b=${encodeURIComponent(hash(r))}`
  ).then((r) => r.json())

  const [c, hc] = computeCAndHc(r, s, await hashPassword(password, authSalt))
  const query = new URLSearchParams({ r, s, sig, hc: toBase64url(hc) })
  const encryptedSalt = await request(`/zkpp/${contract}/contract_hash?${query}`)
    .then((r) => r.text())

  const [contractSalt] = JSON.parse(decryptContractSalt(c, encryptedSalt))
  return contractSalt
}

// TODO: replace with the @chelonia/lib selector once okTurtles/libcheloniajs#90
// lands.
async function lookupUsername (username) {
  const response = await send(`/name/${encodeURIComponent(username)}`)
  if (response.status === 404) return null
  if (!response.ok) throw new AuthError(`Username lookup failed: ${response.status}`)
  return response.text()
}

export async function signup ({ username, password }) {
  assertUsername(username)
  const [contractSalt, saltRegistrationToken] = await registerSalt(username, password)

  // Re-derivable at login, so never stored.
  const IPK = await deriveKeyFromPassword(EDWARDS25519SHA512BATCH, password, contractSalt)
  const IEK = await deriveKeyFromPassword(CURVE25519XSALSA20POLY1305, password, contractSalt)
  // Slot writes are signed with the CSK and encrypted to the CEK. The SAK signs
  // the Shelter authorization header; without it every /kv request fails.
  const CSK = keygen(EDWARDS25519SHA512BATCH)
  const CEK = keygen(CURVE25519XSALSA20POLY1305)
  const SAK = keygen(EDWARDS25519SHA512BATCH)

  // Transient, so neither of the password-derived keys reaches the saved state.
  sbp('chelonia/storeSecretKeys', new Secret([
    { key: IPK, transient: true },
    { key: IEK, transient: true }
  ]))

  let message
  try {
    message = await sbp('chelonia/out/registerContract', {
      contractName: CONTRACT_NAME,
      publishOptions: {
        // chel registers the username and redeems the token while it accepts
        // this first message.
        headers: {
          'shelter-namespace-registration': username,
          'shelter-salt-registration-token': saltRegistrationToken
        }
      },
      signingKeyId: keyId(IPK),
      actionSigningKeyId: keyId(CSK),
      actionEncryptionKeyId: keyId(CEK),
      // TODO: shorten once @chelonia/lib has a helper for building a key set,
      // okTurtles/libcheloniajs#91.
      keys: [
        {
          id: keyId(IPK),
          name: 'ipk',
          purpose: ['sig'],
          ringLevel: 0,
          permissions: '*',
          allowedActions: '*',
          // No `content`: the secret is re-derived from the password.
          meta: { private: { transient: true } },
          data: serializeKey(IPK, false)
        },
        {
          id: keyId(IEK),
          name: 'iek',
          purpose: ['enc'],
          ringLevel: 0,
          permissions: '*',
          meta: { private: { transient: true } },
          data: serializeKey(IEK, false)
        },
        {
          id: keyId(CSK),
          name: 'csk',
          purpose: ['sig'],
          ringLevel: 1,
          permissions: '*',
          allowedActions: '*',
          // Encrypted to the IEK, which is how login recovers it.
          meta: { private: { content: encryptedOutgoingDataWithRawKey(IEK, serializeKey(CSK, true)) } },
          data: serializeKey(CSK, false)
        },
        {
          id: keyId(CEK),
          name: 'cek',
          purpose: ['enc'],
          ringLevel: 1,
          permissions: '*',
          meta: { private: { content: encryptedOutgoingDataWithRawKey(IEK, serializeKey(CEK, true)) } },
          data: serializeKey(CEK, false)
        },
        {
          id: keyId(SAK),
          name: '#sak',
          purpose: ['sak'],
          ringLevel: 0,
          // Chelonia validates all three of these for a #sak.
          permissions: [],
          allowedActions: [],
          meta: { private: { content: encryptedOutgoingDataWithRawKey(IEK, serializeKey(SAK, true)) } },
          data: serializeKey(SAK, false)
        }
      ],
      data: { attributes: { username } }
    })
  } catch (e) {
    // No way to tell the user why yet. chel sends error bodies as plain text
    // and publishEvent does `(await r.json()).message`, so the parse throws and
    // the status is lost: a disabled signup and a rate limit both arrive here
    // as a JSON SyntaxError.
    throw new AuthError('Could not create the account.', { cause: e })
  } finally {
    sbp('chelonia/clearTransientSecretKeys', [keyId(IPK), keyId(IEK)])
  }

  sbp('chelonia/storeSecretKeys', new Secret([{ key: CSK }, { key: CEK }, { key: SAK }]))

  const identityContractID = message.contractID()
  await sbp('chelonia/contract/retain', [identityContractID])
  await enterSession(identityContractID)
  // Todos live on a list contract, so an account with no list has nowhere to
  // put them.
  await createList(DEFAULT_LIST_TITLE)
  return identityContractID
}

export async function login ({ username, password }) {
  assertUsername(username)
  const identityContractID = await lookupUsername(username)
  if (!identityContractID) throw new AuthError('Incorrect username or password.')

  let IEK
  try {
    const contractSalt = await retrieveSalt(identityContractID, password)
    IEK = await deriveKeyFromPassword(CURVE25519XSALSA20POLY1305, password, contractSalt)
  } catch (e) {
    console.error('[todomvc] could not prove the password', e)
    // chel answers a bad proof with a 500, so any status here just means the
    // proof failed. Only a request that got no answer is a different problem.
    if (e instanceof AuthError && e.exact) throw e
    throw new AuthError('Incorrect username or password.', { cause: e })
  }

  sbp('chelonia/storeSecretKeys', new Secret([{ key: IEK, transient: true }]))
  try {
    // Syncing is the recovery step: processing OP_CONTRACT decrypts the CSK,
    // CEK and SAK with the IEK and stores them persistently.
    await sbp('chelonia/contract/retain', [identityContractID])
  } finally {
    sbp('chelonia/clearTransientSecretKeys', [keyId(IEK)])
  }

  await enterSession(identityContractID)
  return identityContractID
}

export async function restoreSession () {
  const identityContractID = state.loggedIn?.identityContractID
  if (!identityContractID) return null

  await retainOrSync(identityContractID)
  sbp('chelonia/kv/refreshFilters')
  await loadLists(identityContractID)
  return identityContractID
}

async function enterSession (identityContractID) {
  state.loggedIn = { identityContractID }
  // The slot's `match` reads loggedIn, which Chelonia cannot watch.
  sbp('chelonia/kv/refreshFilters')
  await sbp('chelonia/contract/wait', [identityContractID])
  await loadLists(identityContractID)
}

// Read from the contract state rather than kept alongside the session, so
// there is one copy of it.
export function currentUsername () {
  const identityContractID = state.loggedIn?.identityContractID
  return identityContractID && state[identityContractID]?.attributes?.username
}

export async function logout () {
  // Stop saving before reset churns through the state, then start again for
  // whoever logs in next.
  clearSavedState()
  delete state.loggedIn
  try {
    await sbp('chelonia/reset', { contracts: {} })
    sbp('chelonia/kv/refreshFilters')
  } finally {
    // Even if reset failed, or the next login would save nothing.
    persistState()
  }
}
