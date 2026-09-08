// Lists: creating one, sharing it, joining one that was shared.
//
// A list is its own contract because keys belong to a contract, and
// OP_KEY_SHARE is how they move between accounts. The identity contract keeps a
// `lists` slot with the IDs of the lists this account is in.

import sbp from '@sbp/sbp'
import { Secret } from '@chelonia/lib/Secret'
import { SPMessage } from '@chelonia/lib/SPMessage'
import { INVITE_STATUS } from '@chelonia/lib/constants'
import {
  encryptedOutgoingData,
  encryptedOutgoingDataWithRawKey
} from '@chelonia/lib/encryptedData'
import {
  CURVE25519XSALSA20POLY1305,
  EDWARDS25519SHA512BATCH,
  deserializeKey,
  keyId,
  keygen,
  serializeKey
} from '@chelonia/crypto'
import { CONTRACT_NAME, LIST_CONTRACT_NAME } from './config.js'
import { state } from './state.js'
import { addList, listsSchema } from './lists-model.js'

const LISTS_KEY = 'lists'
const NO_LISTS = Object.freeze([])
const INVITE_LIFETIME = 7 * 24 * 60 * 60 * 1000

export function defineListsSlot () {
  sbp('chelonia/kv/defineSlot', {
    contractType: CONTRACT_NAME,
    key: LISTS_KEY,
    defaultValue: [],
    schema: listsSchema,
    match: (contractID) => contractID === state.loggedIn?.identityContractID,
    // A list ID landing here, from our own write or from another tab, is what
    // starts that list: open it, then let the todos slot attach to it.
    onUpdate: (value) => {
      openLists(value).catch((e) => console.error('[todomvc] could not open the lists', e))
    }
  })
}

export function currentLists () {
  const identityContractID = state.loggedIn?.identityContractID
  if (!identityContractID) return NO_LISTS
  const entry = state._kv?.[identityContractID]?.[LISTS_KEY]
  if (!entry) return NO_LISTS
  return entry.value ?? sbp('chelonia/kv/read', identityContractID, LISTS_KEY)
}

// From the list contract, so everyone sharing it sees the same title. Missing
// until the key request is answered: the action carrying it is encrypted.
export const listTitle = (contractID) => state[contractID]?.attributes?.title

// No title means no keys yet.
export const listIsPending = (contractID) => !listTitle(contractID)

// The slot loads itself after a sync, but a reload starts with the saved mirror
// already right, and an unchanged value is not an update. So force one read.
export async function loadLists (identityContractID) {
  try {
    await sbp('chelonia/kv/sync', identityContractID, LISTS_KEY)
  } catch (e) {
    console.error('[todomvc] could not load the lists', e)
  }
  await openLists()
}

// A reload starts with the reference already in the saved state, so retaining
// again would leak one.
export const retainOrSync = (contractID) =>
  state.contracts?.[contractID]?.references
    ? sbp('chelonia/contract/sync', [contractID])
    : sbp('chelonia/contract/retain', [contractID])

async function openLists (contractIDs = currentLists()) {
  for (const contractID of contractIDs) {
    try {
      await retainOrSync(contractID)
    } catch (e) {
      console.error(`[todomvc] could not open list ${contractID}`, e)
    }
  }
  // The todos slot's `match` reads the list of lists, which Chelonia cannot
  // watch.
  sbp('chelonia/kv/refreshFilters')
}

function requireIdentity () {
  const identityContractID = state.loggedIn?.identityContractID
  if (!identityContractID) throw new Error('Not logged in')
  return identityContractID
}

const keyIdByName = (contractIDOrState, name) =>
  sbp('chelonia/contract/currentKeyIdByName', contractIDOrState, name)

export async function createList (title) {
  const identityContractID = requireIdentity()

  const CSK = keygen(EDWARDS25519SHA512BATCH)
  const CEK = keygen(CURVE25519XSALSA20POLY1305)
  const SAK = keygen(EDWARDS25519SHA512BATCH)

  // registerContract signs OP_CONTRACT with a key Chelonia already holds.
  sbp('chelonia/storeSecretKeys', new Secret([{ key: CSK }, { key: CEK }, { key: SAK }]))

  // Everything is encrypted to the list's own CEK, so handing over the CEK
  // hands over the rest.
  const secret = (key) => encryptedOutgoingDataWithRawKey(CEK, serializeKey(key, true))

  const message = await sbp('chelonia/out/registerContract', {
    contractName: LIST_CONTRACT_NAME,
    // Only an identity contract may be created without an account to bill it
    // to. The header is signed with our identity's #sak.
    publishOptions: { billableContractID: identityContractID },
    signingKeyId: keyId(CSK),
    actionSigningKeyId: keyId(CSK),
    actionEncryptionKeyId: keyId(CEK),
    keys: [
      {
        id: keyId(CSK),
        name: 'csk',
        purpose: ['sig'],
        ringLevel: 1,
        permissions: '*',
        allowedActions: '*',
        // `shareable` is what an invite hands over: Chelonia answers a key
        // request with exactly the keys carrying it.
        meta: { private: { content: secret(CSK), shareable: true } },
        data: serializeKey(CSK, false)
      },
      {
        id: keyId(CEK),
        name: 'cek',
        purpose: ['enc'],
        ringLevel: 1,
        permissions: '*',
        meta: { private: { content: secret(CEK), shareable: true } },
        data: serializeKey(CEK, false)
      },
      {
        id: keyId(SAK),
        name: '#sak',
        purpose: ['sak'],
        ringLevel: 0,
        permissions: [],
        allowedActions: [],
        // Shared too: /kv is authorized with the contract's own #sak. Scoped
        // to this list, since deletion is checked against the paying account.
        meta: { private: { content: secret(SAK), shareable: true } },
        data: serializeKey(SAK, false)
      }
    ],
    data: { attributes: { title } }
  })

  const contractID = message.contractID()
  await sbp('chelonia/contract/retain', [contractID])
  await shareWithSelf(identityContractID, contractID, [CSK, CEK, SAK])
  await addToLists(identityContractID, contractID)
  return contractID
}

// The same keys into our own identity contract, so a login on another machine
// gets them back. An invite, aimed at ourselves.
async function shareWithSelf (identityContractID, contractID, keys) {
  const identityState = state[identityContractID]
  const CEKid = keyIdByName(identityState, 'cek')
  await sbp('chelonia/out/keyShare', {
    contractID: identityContractID,
    contractName: CONTRACT_NAME,
    signingKeyId: keyIdByName(identityState, 'csk'),
    data: {
      contractID,
      keys: keys.map((key) => ({
        id: keyId(key),
        meta: {
          private: {
            content: encryptedOutgoingData(
              identityContractID, CEKid, serializeKey(key, true)
            )
          }
        }
      }))
    }
  })
}

const addToLists = (identityContractID, contractID) => sbp('chelonia/kv/update', {
  contractID: identityContractID,
  key: LISTS_KEY,
  updater: addList(contractID)
})

// An action, not a slot: renames are rare and the history is worth keeping.
export const renameList = (contractID, title) => sbp('chelonia/out/actionEncrypted', {
  action: `${LIST_CONTRACT_NAME}/rename`,
  contractID,
  data: { title },
  signingKeyId: keyIdByName(contractID, 'csk'),
  encryptionKeyId: keyIdByName(contractID, 'cek')
})

// A key that can only sign one OP_KEY_REQUEST for this list. The secret goes in
// the URL fragment, which browsers never send. Reuses a still-valid invite.
export async function inviteToList (contractID) {
  const listState = state[contractID]
  const now = sbp('chelonia/time')
  const usable = Object.values(listState?._vm?.invites ?? {}).find((invite) =>
    invite.status === INVITE_STATUS.VALID &&
    invite.quantity > 0 &&
    (invite.expires == null || invite.expires > now)
  )
  if (usable) return inviteUrl(contractID, usable.inviteSecret)

  const inviteKey = keygen(EDWARDS25519SHA512BATCH)
  await sbp('chelonia/out/keyAdd', {
    contractID,
    contractName: LIST_CONTRACT_NAME,
    data: [{
      id: keyId(inviteKey),
      // The '#inviteKey-' prefix is what makes Chelonia count uses of the key
      // and refuse it once it is spent or expired.
      name: '#inviteKey-' + keyId(inviteKey),
      purpose: ['sig'],
      ringLevel: Number.MAX_SAFE_INTEGER,
      permissions: [SPMessage.OP_KEY_REQUEST],
      meta: {
        quantity: 1,
        expires: now + INVITE_LIFETIME,
        private: {
          content: encryptedOutgoingData(
            listState, keyIdByName(listState, 'cek'), serializeKey(inviteKey, true)
          )
        }
      },
      data: serializeKey(inviteKey, false)
    }],
    signingKeyId: keyIdByName(listState, 'csk')
  })
  return inviteUrl(contractID, serializeKey(inviteKey, true))
}

const inviteUrl = (contractID, secret) =>
  `${window.location.origin}${window.location.pathname}#/join?` +
  new URLSearchParams({ list: contractID, secret })

export function readInvite (hash = window.location.hash) {
  const [route, query] = hash.replace(/^#\/?/, '').split('?')
  if (route !== 'join' || !query) return null
  const params = new URLSearchParams(query)
  const contractID = params.get('list')
  const secret = params.get('secret')
  return contractID && secret ? { contractID, secret } : null
}

export const clearInvite = () => { window.location.hash = '#/' }

// Publishes the key request. Nothing is readable when this resolves: the owner
// has to be online to answer, and the answer can land in a later session.
export async function acceptInvite ({ contractID, secret }) {
  const identityContractID = requireIdentity()
  if (currentLists().includes(contractID)) return contractID

  const inviteKey = deserializeKey(secret)
  // Transient: it signs one message and is not ours to keep.
  sbp('chelonia/storeSecretKeys', new Secret([{ key: inviteKey, transient: true }]))
  try {
    // Syncs the list too, which is where the public key the request is
    // encrypted to comes from.
    await sbp('chelonia/contract/retain', [contractID])

    const identityState = state[identityContractID]
    await sbp('chelonia/out/keyRequest', {
      originatingContractID: identityContractID,
      originatingContractName: CONTRACT_NAME,
      contractID,
      contractName: LIST_CONTRACT_NAME,
      signingKeyId: keyId(inviteKey),
      innerSigningKeyId: keyIdByName(identityState, 'csk'),
      encryptionKeyId: keyIdByName(identityState, 'cek'),
      innerEncryptionKeyId: keyIdByName(state[contractID], 'cek'),
      // Keeps the server from seeing which two contracts are being connected.
      encryptKeyRequestMetadata: true
    })
  } finally {
    sbp('chelonia/clearTransientSecretKeys', [keyId(inviteKey)])
  }

  // Recorded now rather than when the keys arrive, so a reload still knows to
  // keep the list open and wait for the answer.
  await addToLists(identityContractID, contractID)
  return contractID
}
