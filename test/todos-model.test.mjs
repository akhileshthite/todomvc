import assert from 'node:assert/strict'
import { test } from 'node:test'
import { KV_NOOP } from '@chelonia/lib/kv-constants'
import {
  addTodo,
  removeCompleted,
  removeTodo,
  setAllCompleted,
  setCompleted,
  setTitle,
  sortedTodos,
  todosSchema
} from '../src/chelonia/todos-model.js'

const todo = (over = {}) => ({
  title: 'buy milk',
  completed: false,
  createdDate: '2026-08-04T10:00:00.000Z',
  ...over
})

test('schema accepts a well formed list', () => {
  const value = { a: todo(), b: todo({ title: 'walk', completed: true }) }
  assert.deepEqual(todosSchema.parse(value), value)
})

test('schema drops unknown fields', () => {
  const parsed = todosSchema.parse({ a: { ...todo(), colour: 'red' } })
  assert.deepEqual(Object.keys(parsed.a), ['title', 'completed', 'createdDate'])
})

test('schema rejects values Chelonia reserves or cannot use', () => {
  for (const value of [null, [], 'todos', { a: null }, { a: todo({ title: '' }) }]) {
    assert.throws(() => todosSchema.parse(value), TypeError)
  }
  assert.throws(() => todosSchema.parse({ a: todo({ completed: undefined }) }), TypeError)
  assert.throws(() => todosSchema.parse({ a: todo({ createdDate: 'yesterday' }) }), TypeError)
})

test('addTodo does not touch the previous value', () => {
  const prev = Object.freeze({ a: todo() })
  const next = addTodo({ id: 'b', title: 'walk', createdDate: '2026-08-04T11:00:00.000Z' })(prev)
  assert.deepEqual(Object.keys(next), ['a', 'b'])
  assert.equal(next.b.completed, false)
  assert.deepEqual(prev, { a: todo() })
})

test('reducers abort when there is nothing to write', () => {
  const prev = { a: todo() }
  assert.equal(setCompleted('a', false)(prev), KV_NOOP)
  assert.equal(setCompleted('missing', true)(prev), KV_NOOP)
  assert.equal(setTitle('a', 'buy milk')(prev), KV_NOOP)
  assert.equal(removeTodo('missing')(prev), KV_NOOP)
  assert.equal(setAllCompleted(false)(prev), KV_NOOP)
  assert.equal(removeCompleted()(prev), KV_NOOP)
})

test('reducers apply the change they are asked for', () => {
  const prev = { a: todo(), b: todo({ completed: true }) }
  assert.equal(setCompleted('a', true)(prev).a.completed, true)
  assert.equal(setTitle('a', 'walk')(prev).a.title, 'walk')
  assert.deepEqual(Object.keys(removeTodo('a')(prev)), ['b'])
  assert.deepEqual(Object.keys(removeCompleted()(prev)), ['a'])
  assert.equal(Object.values(setAllCompleted(true)(prev)).every((t) => t.completed), true)
})

// Chelonia re-runs a reducer against the server's copy on a conflict.
test('a reducer re-run against a newer value keeps the other change', () => {
  const mine = addTodo({ id: 'mine', title: 'mine', createdDate: '2026-08-04T10:00:00.000Z' })
  const serverCopy = { theirs: todo({ title: 'theirs' }) }
  assert.deepEqual(Object.keys(mine(serverCopy)).sort(), ['mine', 'theirs'])
})

test('sortedTodos orders by creation date, then id', () => {
  const value = {
    b: todo({ createdDate: '2026-08-04T12:00:00.000Z' }),
    a: todo({ createdDate: '2026-08-04T10:00:00.000Z' })
  }
  assert.deepEqual(sortedTodos(value).map((t) => t.id), ['a', 'b'])
})
