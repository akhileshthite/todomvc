// Signup, login, logout and session restore.
//
// IPK and IEK are derived from the password and never stored. CSK, CEK and SAK
// are random, and their secret halves sit in the contract encrypted to the IEK.
// That is what makes login work on a machine that has never seen the account:
// deriving the IEK is enough for Chelonia to open them while it syncs.

import sbp from '@sbp/sbp'
import { Secret } from '@chelonia/lib/Secret'
import { encryptedIncomingData, encryptedOutgoingDataWithRawKey } from '@chelonia/lib/encryptedData'
import { blake32Hash, bytesToB64 } from '@chelonia/lib/functions'
import {
  base64ToBase64url,
  boxKeyPair,
  buildRegisterSaltRequest,
  buildUpdateSaltRequestEc,
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
  generateSalt,
  keyId,
  keygen,
  serializeKey
} from '@chelonia/crypto'
import { API_URL, CONTRACT_NAME } from './config.js'
import { createList, currentLists, loadLists, retainOrSync } from './lists.js'
import { dropPendingWrites, loadOfflineQueue } from './offline.js'
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

// TODO: BEGIN REMOVEME (copy of chel's private NAME_REGEX, until chel exports it)
// Copied from NAME_REGEX in chel's src/serve/routes.ts. The server rejects
// anything else with a 400, so check here first to give a usable message.
// Lowercase only, cannot start or end with - or _, and no repeated separator.
const USERNAME_REGEX = /^(?![_-])((?!([_-])\2)[a-z\d_-]){1,80}(?<![_-])$/
// TODO: END REMOVEME (copy of chel's private NAME_REGEX, until chel exports it)

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

  // This is where a taken username is caught: the server looks the name up
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

// TODO: BEGIN REMOVEME (okTurtles/libcheloniajs#90)
// Replaced by `chelonia/out/nameToContractID` once a @chelonia/lib release has
// it. The call in login() changes with it.
async function lookupUsername (username) {
  const response = await send(`/name/${encodeURIComponent(username)}`)
  if (response.status === 404) return null
  if (!response.ok) throw new AuthError(`Username lookup failed: ${response.status}`)
  return response.text()
}
// TODO: END REMOVEME (okTurtles/libcheloniajs#90)

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
  // Lets the account delete itself later. The server keeps only the hash, and
  // the token sits in the contract encrypted to the IEK, so deleting takes the
  // password.
  const deletionToken = generateSalt()

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
          'shelter-salt-registration-token': saltRegistrationToken,
          'shelter-deletion-token-digest': blake32Hash(deletionToken)
        }
      },
      signingKeyId: keyId(IPK),
      actionSigningKeyId: keyId(CSK),
      actionEncryptionKeyId: keyId(CEK),
      // TODO (okTurtles/libcheloniajs#91): shorten this once @chelonia/lib has
      // a helper for building a key set.
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
      data: {
        attributes: {
          username,
          encryptedDeletionToken: encryptedOutgoingDataWithRawKey(IEK, deletionToken)
            .serialize('encryptedDeletionToken')
        }
      }
    })
  } catch (e) {
    // TODO: BEGIN REMOVEME (okTurtles/libcheloniajs#94)
    // No way to tell the user why yet. chel sends error bodies as plain text
    // and publishEvent does `(await r.json()).message`, so the parse throws and
    // the status is lost: a disabled signup and a rate limit both arrive here
    // as a JSON SyntaxError. Once a release carries the status on `cause`,
    // 403 and 429 get their own messages here.
    // TODO: END REMOVEME (okTurtles/libcheloniajs#94)
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
    // After a password change those three are only readable from the key
    // update onwards, so the first pass could not open anything before it.
    // Go through the log once more now that they are known.
    if (state.contracts[identityContractID]?.missingDecryptionKeyIds?.length) {
      await sbp('chelonia/contract/sync', [identityContractID], { resync: true })
    }
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
  await loadOfflineQueue((contractID) => currentLists().includes(contractID))
  return identityContractID
}

async function enterSession (identityContractID) {
  state.loggedIn = { identityContractID }
  // The slot's `match` reads loggedIn, which Chelonia cannot watch.
  sbp('chelonia/kv/refreshFilters')
  await sbp('chelonia/contract/wait', [identityContractID])
  await loadLists(identityContractID)
  await loadOfflineQueue((contractID) => currentLists().includes(contractID))
}

function currentIdentity () {
  const identityContractID = state.loggedIn?.identityContractID
  if (!identityContractID) throw new AuthError('Not logged in.')
  return identityContractID
}

const keyIdByName = (contractState, name) =>
  sbp('chelonia/contract/currentKeyIdByName', contractState, name)

export async function changePassword ({ oldPassword, newPassword }) {
  const identityContractID = currentIdentity()
  const identityState = state[identityContractID]
  const contract = encodeURIComponent(identityContractID)

  // Same proof as login. The new password travels encrypted to that proof's
  // shared secret, and the answer is the old salt plus a one-time token that
  // lets the next message swap the salts on the server.
  let oldContractSalt, newContractSalt, updateToken
  try {
    const r = randomNonce()
    const { authSalt, s, sig } = await request(
      `/zkpp/${contract}/auth_hash?b=${encodeURIComponent(hash(r))}`
    ).then((r) => r.json())
    const [c, hc] = computeCAndHc(r, s, await hashPassword(oldPassword, authSalt))
    const [salt, Ea] = await buildUpdateSaltRequestEc(newPassword, c)
    newContractSalt = salt
    const encrypted = await request(
      `/zkpp/${contract}/updatePasswordHash`,
      form({ r, s, sig, hc: toBase64url(hc), Ea })
    ).then((r) => r.json())
    ;[oldContractSalt, updateToken] = JSON.parse(decryptContractSalt(c, encrypted))
  } catch (e) {
    if (e instanceof AuthError && e.exact) throw e
    throw new AuthError('Incorrect password.', { cause: e })
  }

  const oldIPK = await deriveKeyFromPassword(EDWARDS25519SHA512BATCH, oldPassword, oldContractSalt)
  const oldIEK = await deriveKeyFromPassword(CURVE25519XSALSA20POLY1305, oldPassword, oldContractSalt)
  const IPK = await deriveKeyFromPassword(EDWARDS25519SHA512BATCH, newPassword, newContractSalt)
  const IEK = await deriveKeyFromPassword(CURVE25519XSALSA20POLY1305, newPassword, newContractSalt)

  // Read while the old IEK is still the current key.
  const encryptedToken = identityState.attributes?.encryptedDeletionToken
  const deletionToken = encryptedToken && encryptedIncomingData(
    identityContractID, identityState, encryptedToken, NaN,
    { [keyId(oldIEK)]: oldIEK }, 'encryptedDeletionToken'
  ).valueOf()

  sbp('chelonia/storeSecretKeys', new Secret(
    [oldIPK, oldIEK, IPK, IEK].map((key) => ({ key, transient: true }))
  ))
  try {
    // Only the two password keys are replaced. The everyday keys stay and get
    // their secrets encrypted again to the new IEK, so nothing already on the
    // contract has to be rewritten. The same id and public key go back in,
    // since Chelonia checks the decrypted secret against the entry's id.
    const keep = (name) => {
      const id = keyIdByName(identityState, name)
      return {
        id,
        name,
        oldKeyId: id,
        data: identityState._vm.authorizedKeys[id].data,
        meta: { private: { content: encryptedOutgoingDataWithRawKey(IEK, state.secretKeys[id]) } }
      }
    }
    await sbp('chelonia/out/keyUpdate', {
      contractID: identityContractID,
      contractName: CONTRACT_NAME,
      data: [
        {
          id: keyId(IPK),
          name: 'ipk',
          oldKeyId: keyId(oldIPK),
          meta: { private: { transient: true } },
          data: serializeKey(IPK, false)
        },
        {
          id: keyId(IEK),
          name: 'iek',
          oldKeyId: keyId(oldIEK),
          meta: { private: { transient: true } },
          data: serializeKey(IEK, false)
        },
        keep('csk'),
        keep('cek'),
        keep('#sak')
      ],
      signingKeyId: keyId(oldIPK),
      // The server swaps the salts while it accepts this message.
      publishOptions: { headers: { 'shelter-salt-update-token': updateToken } }
    })
    if (deletionToken) {
      await sbp('chelonia/out/actionEncrypted', {
        action: `${CONTRACT_NAME}/setDeletionToken`,
        contractID: identityContractID,
        data: {
          encryptedDeletionToken: encryptedOutgoingDataWithRawKey(IEK, deletionToken)
            .serialize('encryptedDeletionToken')
        },
        signingKeyId: keyIdByName(identityState, 'csk'),
        encryptionKeyId: keyIdByName(identityState, 'cek')
      })
    }
    await sbp('chelonia/contract/wait', [identityContractID])
  } finally {
    sbp('chelonia/clearTransientSecretKeys', [oldIPK, oldIEK, IPK, IEK].map(keyId))
  }
}

export async function deleteAccount ({ password }) {
  const identityContractID = currentIdentity()
  const identityState = state[identityContractID]
  const encryptedToken = identityState?.attributes?.encryptedDeletionToken
  if (!encryptedToken) {
    throw new AuthError('This account was made before deleting was possible.')
  }

  let token
  try {
    const contractSalt = await retrieveSalt(identityContractID, password)
    const IEK = await deriveKeyFromPassword(CURVE25519XSALSA20POLY1305, password, contractSalt)
    token = encryptedIncomingData(
      identityContractID, identityState, encryptedToken, NaN,
      { [keyId(IEK)]: IEK }, 'encryptedDeletionToken'
    ).valueOf()
  } catch (e) {
    if (e instanceof AuthError && e.exact) throw e
    throw new AuthError('Incorrect password.', { cause: e })
  }

  // The server takes it from here and also deletes the lists this account
  // created. Lists it only joined belong to whoever made them.
  const [result] = await sbp('chelonia/out/deleteContract', identityContractID, {
    [identityContractID]: { token: new Secret(token) }
  })
  if (result.status === 'rejected') {
    throw new AuthError('Could not delete the account.', { cause: result.reason })
  }
  await logout()
}

// Read from the contract state rather than kept alongside the session, so
// there is one copy of it.
export function currentUsername () {
  const identityContractID = state.loggedIn?.identityContractID
  return identityContractID && state[identityContractID]?.attributes?.username
}

export async function logout () {
  // Unsent writes cannot go out without this account's keys.
  await dropPendingWrites()
  sbp('chelonia.persistentActions/unload')
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
