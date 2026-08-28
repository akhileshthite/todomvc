<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  clearCompleted,
  complete,
  completeAll,
  create,
  currentTodos,
  destroy,
  rename,
  todosStatus
} from '../chelonia/todos.js'
import { connection } from '../chelonia/connection.js'
import { MAX_TITLE_LENGTH, sortedTodos } from '../chelonia/todos-model.js'

const props = defineProps({
  listId: { type: String, required: true }
})

const FILTERS = {
  all: () => true,
  active: (todo) => !todo.completed,
  completed: (todo) => todo.completed
}

const newTitle = ref('')
const newTodoInput = ref(null)
const editingId = ref(null)
const editTitle = ref('')
const editInput = ref(null)
const filter = ref(readFilter())
const error = ref('')

// currentTodos() reads Chelonia's KV mirror, which lives in the reactive root
// state, so this recomputes on a local write and on a push from another tab
// or another account alike. There is nothing to subscribe to.
const todos = computed(() => sortedTodos(currentTodos(props.listId)))
const visible = computed(() => todos.value.filter(FILTERS[filter.value]))
const remaining = computed(() => todos.value.filter((todo) => !todo.completed).length)
// A key that has never been written settles back to 'non-init', so only
// 'loading' means a fetch is in flight.
const loading = computed(() => todosStatus(props.listId) === 'loading')
// The mirror still holds the last good value, so the list stays on screen.
const stale = computed(() => todosStatus(props.listId) === 'error')
// Nothing is queued while the relay is unreachable, so a change made now is
// simply lost. Rather than let people pile up work that gets thrown away, the
// list goes read only and stays readable.
const readOnly = computed(() => !connection.online)

function readFilter () {
  const name = window.location.hash.replace(/^#\/?/, '')
  return name in FILTERS ? name : 'all'
}

const onHashChange = () => { filter.value = readFilter() }

onMounted(() => {
  window.addEventListener('hashchange', onHashChange)
  // The `autofocus` attribute only fires while the page is parsed, and this
  // component mounts later, after Chelonia has started.
  newTodoInput.value?.focus()
})
onUnmounted(() => window.removeEventListener('hashchange', onHashChange))

// Switching lists leaves the old list's edit open over the new one's todos.
watch(() => props.listId, () => { editingId.value = null })

// Writes go to the server, so any of them can fail.
async function run (write) {
  error.value = ''
  try {
    await write()
  } catch (e) {
    error.value = 'That change could not be saved.'
    console.error('[todomvc] write failed', e)
  }
}

function add () {
  const title = newTitle.value.trim()
  if (!title || readOnly.value) return
  newTitle.value = ''
  run(() => create(props.listId, title))
}

function startEditing (todo) {
  if (readOnly.value) return
  editingId.value = todo.id
  editTitle.value = todo.title
  nextTick(() => editInput.value?.[0]?.focus())
}

function finishEditing () {
  const id = editingId.value
  // Disabling the input fires blur. Keep the edit open and the typing intact
  // until the connection is back, instead of discarding it.
  if (id === null || readOnly.value) return
  const title = editTitle.value.trim()
  editingId.value = null
  run(() => (title ? rename(props.listId, id, title) : destroy(props.listId, id)))
}
</script>

<template>
  <section class="todos">
    <header>
      <input
        ref="newTodoInput"
        v-model="newTitle"
        class="new-todo"
        placeholder="What needs to be done?"
        :maxlength="MAX_TITLE_LENGTH"
        :disabled="readOnly"
        autofocus
        @keyup.enter="add"
      >
    </header>

    <p v-if="readOnly" class="todo-notice">
      Not connected to the server, so the list is read only right now. It will
      be editable again once the connection is back.
    </p>
    <p v-if="error" class="todo-error">{{ error }}</p>
    <p v-else-if="stale" class="todo-error">
      The server sent a todo list this app cannot read, so this is the last
      version it could.
    </p>
    <p v-else-if="loading" class="todo-status">Loading your todos&hellip;</p>

    <template v-if="todos.length">
      <label class="toggle-all">
        <input
          type="checkbox"
          :checked="remaining === 0"
          :disabled="readOnly"
          @change="run(() => completeAll(listId, remaining !== 0))"
        >
        Mark all as complete
      </label>

      <ul class="todo-list">
        <li
          v-for="todo in visible"
          :key="todo.id"
          :class="{ completed: todo.completed, editing: editingId === todo.id }"
        >
          <div class="view">
            <input
              class="toggle"
              type="checkbox"
              :checked="todo.completed"
              :disabled="readOnly"
              @change="run(() => complete(listId, todo.id, !todo.completed))"
            >
            <label @dblclick="startEditing(todo)">{{ todo.title }}</label>
            <button
              class="destroy"
              title="Delete"
              :disabled="readOnly"
              @click="run(() => destroy(listId, todo.id))"
            >
              &times;
            </button>
          </div>
          <input
            v-if="editingId === todo.id"
            ref="editInput"
            v-model="editTitle"
            class="edit"
            :maxlength="MAX_TITLE_LENGTH"
            :disabled="readOnly"
            @blur="finishEditing"
            @keyup.enter="finishEditing"
            @keyup.escape="editingId = null"
          >
        </li>
      </ul>

      <footer class="todo-footer">
        <span class="todo-count">
          <strong>{{ remaining }}</strong> {{ remaining === 1 ? 'item' : 'items' }} left
        </span>
        <nav class="filters">
          <a href="#/" :class="{ selected: filter === 'all' }">All</a>
          <a href="#/active" :class="{ selected: filter === 'active' }">Active</a>
          <a href="#/completed" :class="{ selected: filter === 'completed' }">Completed</a>
        </nav>
        <button
          v-if="remaining < todos.length"
          type="button"
          class="link clear-completed"
          :disabled="readOnly"
          @click="run(() => clearCompleted(listId))"
        >
          Clear completed
        </button>
      </footer>
    </template>
  </section>
</template>
