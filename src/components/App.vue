<script setup>
import { computed } from 'vue'
import { currentUsername, logout, state } from '../chelonia/index.js'
import AuthView from './AuthView.vue'
import TodoApp from './TodoApp.vue'

const props = defineProps({
  bootError: { type: Error, default: null }
})

const loggedIn = computed(() => !props.bootError && !!state.loggedIn)
const username = computed(() => currentUsername())

async function onLogout () {
  try {
    await logout()
  } catch (e) {
    console.error('[todomvc] logout failed', e)
  }
}
</script>

<template>
  <main class="app">
    <h1>todos</h1>
    <p v-if="bootError" class="boot-error">
      Could not reach the server. Start it with <code>npm run serve</code> and
      reload this page.
    </p>
    <TodoApp v-else-if="loggedIn" />
    <AuthView v-else />
    <footer v-if="loggedIn" class="session">
      signed in as <strong>{{ username }}</strong>
      <button type="button" class="link" @click="onLogout">log out</button>
    </footer>
  </main>
</template>
