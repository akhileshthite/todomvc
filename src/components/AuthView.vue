<script setup>
import { ref } from 'vue'
import { AuthError, login, signup } from '../chelonia/index.js'

defineProps({
  // Arrived on an invite link, so say what the account is for before asking
  // for one.
  invited: { type: Boolean, default: false }
})

const mode = ref('login')
const username = ref('')
const password = ref('')
const busy = ref(false)
const error = ref('')

async function submit () {
  error.value = ''
  busy.value = true
  try {
    const credentials = { username: username.value.trim(), password: password.value }
    await (mode.value === 'signup' ? signup(credentials) : login(credentials))
    password.value = ''
  } catch (e) {
    error.value = e instanceof AuthError ? e.message : 'Something went wrong. Check the console.'
    console.error('[todomvc] auth failed', e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <form class="auth" @submit.prevent="submit">
    <p v-if="invited" class="auth-intro">
      Someone shared a todo list with you. Log in or create an account, and the
      invite carries on from there.
    </p>
    <p class="auth-intro">
      Your keys are generated in this browser. The todos are encrypted before
      they reach the server.
    </p>

    <label>
      Username
      <input
        v-model="username"
        type="text"
        autocomplete="username"
        required
      >
      <!-- No `pattern` attribute: it compiles with the regex `v` flag, where
           the `[_-]` classes in USERNAME_REGEX are a syntax error, and a
           pattern that fails to compile is dropped without warning. signup()
           and login() check the same rule in JS instead. -->
      <small v-if="mode === 'signup'">
        lowercase letters, numbers, hyphen and underscore
      </small>
    </label>

    <label>
      Password
      <input
        v-model="password"
        type="password"
        :autocomplete="mode === 'signup' ? 'new-password' : 'current-password'"
        required
        minlength="7"
      >
    </label>

    <p v-if="error" class="auth-error">{{ error }}</p>

    <button type="submit" :disabled="busy">
      {{ mode === 'signup' ? 'Create account' : 'Log in' }}
    </button>

    <button
      type="button"
      class="link"
      @click="mode = mode === 'signup' ? 'login' : 'signup'"
    >
      {{ mode === 'signup' ? 'I already have an account' : 'Create an account' }}
    </button>
  </form>
</template>
