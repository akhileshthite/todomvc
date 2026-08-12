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
import { clearSavedState, persistState, state } from './state.js'

export class AuthError extends Error {
  constructor (message, options) {
    super(message, options)
    this.name = 'AuthError'
  }
}

// Copied from NAME_REGEX in chel's src/serve/routes.ts. The relay rejects
// anything else with a 400, so check here first to give a usable message.
// Lowercase only, cannot start or end with - or _, and no repeated separator.
const USERNAME_REGEX = /^(?![_-])((?!([_-])\2)[a-z\d_-]){1,80}(?<![_-])$/

function assertUsername (username) {
  if (!USERNAME_REGEX.test(username)) {
    throw new AuthError(
      'Usernames can use lowercase letters, numbers, hyphen and underscore, ' +
      'and cannot start or end with a hyphen or underscore.'
    )
  }
}

async function request (path, init) {
  const response = await fetch(`${API_URL}${path}`, init)
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
  const r = bytesToB64(keyPair.publicKey).replace(/\//g, '_').replace(/\+/g, '-')
  const path = `/zkpp/register/${encodeURIComponent(username)}`

  // This is where a taken username is caught: the relay looks the name up
  // before it will issue a registration key.
  const challenge = await fetch(`${API_URL}${path}`, form({ b: hash(r) }))
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

async function lookupUsername (username) {
  const response = await fetch(`${API_URL}/name/${encodeURIComponent(username)}`)
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
    throw new AuthError('Could not create the account.', { cause: e })
  } finally {
    sbp('chelonia/clearTransientSecretKeys', [keyId(IPK), keyId(IEK)])
  }

  sbp('chelonia/storeSecretKeys', new Secret([{ key: CSK }, { key: CEK }, { key: SAK }]))

  const identityContractID = message.contractID()
  await sbp('chelonia/contract/retain', [identityContractID])
  await enterSession(identityContractID)
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

  // The saved state already carries a reference, so retaining again on every
  // reload would leak one.
  if (state.contracts?.[identityContractID]?.references) {
    await sbp('chelonia/contract/sync', [identityContractID])
  } else {
    await sbp('chelonia/contract/retain', [identityContractID])
  }
  sbp('chelonia/kv/refreshFilters')
  return identityContractID
}

async function enterSession (identityContractID) {
  state.loggedIn = { identityContractID }
  // The slot's `match` reads loggedIn, which Chelonia cannot watch.
  sbp('chelonia/kv/refreshFilters')
  await sbp('chelonia/contract/wait', [identityContractID])
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
  await sbp('chelonia/reset', { contracts: {} })
  sbp('chelonia/kv/refreshFilters')
  persistState()
}
