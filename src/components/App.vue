<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { currentUsername, logout, state } from '../chelonia/index.js'
import { currentLists, listIsPending, readInvite } from '../chelonia/lists.js'
import AccountPanel from './AccountPanel.vue'
import AuthView from './AuthView.vue'
import JoinView from './JoinView.vue'
import ListsBar from './ListsBar.vue'
import TodoApp from './TodoApp.vue'

const props = defineProps({
  bootError: { type: Error, default: null }
})

const loggedIn = computed(() => !props.bootError && !!state.loggedIn)
const username = computed(() => currentUsername())
const lists = computed(() => currentLists())
const invite = ref(readInvite())
const selectedListId = ref(null)
const showAccount = ref(false)

// A list that was just joined has no keys yet, so nothing about it can be read.
const pending = computed(() => !!selectedListId.value && listIsPending(selectedListId.value))

// Lists arrive after login and can arrive later still, when another tab adds
// one or an invite is answered.
watch(lists, (contractIDs) => {
  if (!contractIDs.includes(selectedListId.value)) {
    selectedListId.value = contractIDs[0] ?? null
  }
}, { immediate: true })

// Show what was just joined, even though there is nothing in it until the
// owner answers. Nothing is passed when the invite was declined.
function onJoined (contractID) {
  invite.value = null
  if (typeof contractID === 'string') selectedListId.value = contractID
}

const onHashChange = () => { invite.value = readInvite() }
onMounted(() => window.addEventListener('hashchange', onHashChange))
onUnmounted(() => window.removeEventListener('hashchange', onHashChange))

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
    <template v-else-if="loggedIn">
      <JoinView v-if="invite" :invite="invite" @done="onJoined" />
      <AccountPanel v-else-if="showAccount" @close="showAccount = false" />
      <template v-else>
        <ListsBar v-model="selectedListId" :lists="lists" :pending="pending" />
        <p v-if="pending" class="list-pending">
          Waiting for whoever shared this list to answer. They have to be online
          with the app open; nothing on the server can answer for them.
        </p>
        <TodoApp v-else-if="selectedListId" :list-id="selectedListId" />
      </template>
    </template>
    <AuthView v-else :invited="!!invite" />
    <footer v-if="loggedIn" class="session">
      signed in as <strong>{{ username }}</strong>
      <button type="button" class="link" @click="showAccount = !showAccount">account</button>
      <button type="button" class="link" @click="onLogout">log out</button>
    </footer>
  </main>
</template>
