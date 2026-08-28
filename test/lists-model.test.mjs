import assert from 'node:assert/strict'
import { test } from 'node:test'
import { KV_NOOP } from '@chelonia/lib/kv-constants'
import { addList, listsSchema } from '../src/chelonia/lists-model.js'

const ID = 'zLDXeQ2AgfCuHJdjXoq2jX4XBRSWWzgFkM6WryzsQe4pBzd9qk85Pp54'
const OTHER = 'zLDXeQ2AgfCuH7oQQb5fuzuGjnBiPP6Ff35WAwEGifjBQ1dmg3wSK9ck'

test('schema accepts a list of contract IDs and keeps the order', () => {
  assert.deepEqual(listsSchema.parse([ID, OTHER]), [ID, OTHER])
  assert.deepEqual(listsSchema.parse([]), [])
})

test('schema rejects values Chelonia reserves or cannot use', () => {
  for (const value of [null, {}, 'lists', [null], [''], [1]]) {
    assert.throws(() => listsSchema.parse(value), TypeError)
  }
})

test('schema rejects the same list twice', () => {
  assert.throws(() => listsSchema.parse([ID, ID]), TypeError)
})

test('addList appends without touching the previous value', () => {
  const prev = Object.freeze([OTHER])
  assert.deepEqual(addList(ID)(prev), [OTHER, ID])
  assert.deepEqual(prev, [OTHER])
})

test('adding a list already there is cancelled', () => {
  assert.equal(addList(ID)([ID]), KV_NOOP)
})

// Joining the same list from two tabs at once: the second write is re-run
// against the first one's value, and the reducer drops it instead of adding
// the ID twice, which the schema would then reject.
test('two joins of the same list converge on one entry', () => {
  const add = addList(ID)
  assert.deepEqual(add([]), [ID])
  assert.equal(add(add([])), KV_NOOP)
})
