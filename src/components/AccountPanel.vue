<script setup>
import { ref } from 'vue'
import { AuthError, changePassword, deleteAccount } from '../chelonia/index.js'

const emit = defineEmits(['close'])

const oldPassword = ref('')
const newPassword = ref('')
const deletePassword = ref('')
const busy = ref(false)
const message = ref('')
const error = ref('')

async function run (task, done) {
  error.value = ''
  message.value = ''
  busy.value = true
  try {
    await task()
    message.value = done
  } catch (e) {
    error.value = e instanceof AuthError ? e.message : 'Something went wrong. Check the console.'
    console.error('[todomvc] account change failed', e)
  } finally {
    busy.value = false
  }
}

const submitPassword = () => run(async () => {
  await changePassword({ oldPassword: oldPassword.value, newPassword: newPassword.value })
  oldPassword.value = ''
  newPassword.value = ''
}, 'Password changed. Use the new one from the next login on.')

// After this the session is gone, so App shows the login form.
const submitDelete = () => run(() => deleteAccount({ password: deletePassword.value }), '')
</script>

<template>
  <section class="account">
    <form class="auth" @submit.prevent="submitPassword">
      <h2>Change password</h2>
      <label>
        Current password
        <input v-model="oldPassword" type="password" autocomplete="current-password" required>
      </label>
      <label>
        New password
        <input
          v-model="newPassword"
          type="password"
          autocomplete="new-password"
          required
          minlength="7"
        >
      </label>
      <button type="submit" :disabled="busy">Change password</button>
    </form>

    <form class="auth" @submit.prevent="submitDelete">
      <h2>Delete account</h2>
      <p class="auth-intro">
        This deletes the account and every list it created, on the server too.
        Lists that others shared with you stay with them.
      </p>
      <label>
        Password
        <input v-model="deletePassword" type="password" autocomplete="current-password" required>
      </label>
      <button type="submit" :disabled="busy">Delete my account</button>
    </form>

    <p v-if="error" class="auth-error">{{ error }}</p>
    <p v-if="message" class="account-message">{{ message }}</p>
    <button type="button" class="link" @click="emit('close')">Back to the lists</button>
  </section>
</template>
