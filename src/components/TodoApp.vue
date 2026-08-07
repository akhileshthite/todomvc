<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
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
import { MAX_TITLE_LENGTH, sortedTodos } from '../chelonia/todos-model.js'

const FILTERS = {
  all: () => true,
  active: (todo) => !todo.completed,
  completed: (todo) => todo.completed
}

const newTitle = ref('')
const editingId = ref(null)
const editTitle = ref('')
const editInput = ref(null)
const filter = ref(readFilter())
const error = ref('')

// currentTodos() reads Chelonia's KV mirror, which lives in the reactive root
// state, so this recomputes on a local write and on a push from another tab
// alike. There is nothing to subscribe to.
const todos = computed(() => sortedTodos(currentTodos()))
const visible = computed(() => todos.value.filter(FILTERS[filter.value]))
const remaining = computed(() => todos.value.filter((todo) => !todo.completed).length)
// A key that has never been written settles back to 'non-init', so only
// 'loading' means a fetch is in flight.
const loading = computed(() => todosStatus() === 'loading')

function readFilter () {
  const name = window.location.hash.replace(/^#\/?/, '')
  return name in FILTERS ? name : 'all'
}

const onHashChange = () => { filter.value = readFilter() }
onMounted(() => window.addEventListener('hashchange', onHashChange))
onUnmounted(() => window.removeEventListener('hashchange', onHashChange))

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
  if (!title) return
  newTitle.value = ''
  run(() => create(title))
}

function startEditing (todo) {
  editingId.value = todo.id
  editTitle.value = todo.title
  nextTick(() => editInput.value?.[0]?.focus())
}

function finishEditing () {
  const id = editingId.value
  if (id === null) return
  const title = editTitle.value.trim()
  editingId.value = null
  run(() => (title ? rename(id, title) : destroy(id)))
}
</script>

<template>
  <section class="todos">
    <header>
      <input
        v-model="newTitle"
        class="new-todo"
        placeholder="What needs to be done?"
        :maxlength="MAX_TITLE_LENGTH"
        autofocus
        @keyup.enter="add"
      >
    </header>

    <p v-if="error" class="todo-error">{{ error }}</p>
    <p v-else-if="loading" class="todo-status">Loading your todos&hellip;</p>

    <template v-if="todos.length">
      <label class="toggle-all">
        <input
          type="checkbox"
          :checked="remaining === 0"
          @change="run(() => completeAll(remaining !== 0))"
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
              @change="run(() => complete(todo.id, !todo.completed))"
            >
            <label @dblclick="startEditing(todo)">{{ todo.title }}</label>
            <button class="destroy" title="Delete" @click="run(() => destroy(todo.id))">&times;</button>
          </div>
          <input
            v-if="editingId === todo.id"
            ref="editInput"
            v-model="editTitle"
            class="edit"
            :maxlength="MAX_TITLE_LENGTH"
            @blur="finishEditing"
            @keyup.enter="finishEditing"
            @keyup.escape="editingId = null"
          >
        </li>
      </ul>

      <footer class="todo-footer">
        <span>{{ remaining }} {{ remaining === 1 ? 'item' : 'items' }} left</span>
        <nav>
          <a href="#/" :class="{ selected: filter === 'all' }">All</a>
          <a href="#/active" :class="{ selected: filter === 'active' }">Active</a>
          <a href="#/completed" :class="{ selected: filter === 'completed' }">Completed</a>
        </nav>
        <button
          v-if="remaining < todos.length"
          type="button"
          class="link"
          @click="run(clearCompleted)"
        >
          Clear completed
        </button>
      </footer>
    </template>
  </section>
</template>
