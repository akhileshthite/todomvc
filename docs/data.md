# The todos slot and the writes

This is for someone reading `src/chelonia/todos.js` and `lists.js`. The README
says what happens; this shows the code.

Two slots are declared once, at startup. `lists` on the identity contract holds
the IDs of the lists this account is in, and `todos` attaches to each of those
lists:

```js
sbp('chelonia/kv/defineSlot', {
  contractType: 'todomvc/list',
  key: 'todos',
  defaultValue: {},
  schema: todosSchema,
  match: (contractID, contractState) =>
    currentLists().includes(contractID) &&
    !!sbp('chelonia/contract/currentKeyIdByName', contractState, '#sak', true)
})
```

`match` decides which contracts a slot attaches to. The second half of it is
what makes a shared list wait: a list you have just joined is in `lists`, but
until its keys arrive there is nothing you could read or write, because the
server checks the contract's `#sak` before serving `/kv/:contractID/:key`. See
[sharing.md](sharing.md) for how the keys arrive.

Every write is a reducer:

```js
sbp('chelonia/kv/update', {
  contractID,
  key: 'todos',
  updater: (prev) => ({ ...prev, [id]: { title, completed: false, createdDate } })
})
```

No etags, no conflict callback, no per-key event. The server rejects a write
that was based on a stale value, and Chelonia responds by refetching and running
the reducer again on the newer one. That is why two windows converge. Returning
`KV_NOOP` from a reducer cancels the write, which is how toggling a todo that is
already in that state avoids a pointless round trip.

Reading does not go over the network. Chelonia keeps a local copy of every
declared slot at `rootState._kv[contractID][key]` and updates it from four
places: the first load, a push from another client, our own write, and a
refetch after the socket reconnects. That state object is a Vue `reactive()`,
so a `computed` over it reruns on all four and the list redraws by itself.
