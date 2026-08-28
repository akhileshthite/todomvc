import { KV_NOOP } from '@chelonia/lib/kv-constants'

// The lists slot on the identity contract: which lists this account is in, in
// the order they were added. Nothing else, because everything else about a list
// (its title, its todos) belongs to the list contract and has to be the same for
// everyone sharing it.

export const listsSchema = {
  parse (value) {
    if (!Array.isArray(value)) {
      throw new TypeError('lists must be an array of contract IDs')
    }
    const seen = new Set()
    for (const contractID of value) {
      if (typeof contractID !== 'string' || contractID.length === 0) {
        throw new TypeError('a list ID must be a non-empty string')
      }
      if (seen.has(contractID)) {
        throw new TypeError(`list ${contractID} appears twice`)
      }
      seen.add(contractID)
    }
    return [...value]
  }
}

export const addList = (contractID) => (prev) =>
  prev.includes(contractID) ? KV_NOOP : [...prev, contractID]
