<script setup>
import { ref } from 'vue'
import { acceptInvite, clearInvite } from '../chelonia/lists.js'

const props = defineProps({
  invite: { type: Object, required: true }
})
const emit = defineEmits(['done'])

const busy = ref(false)
const error = ref('')

async function join () {
  error.value = ''
  busy.value = true
  try {
    done(await acceptInvite(props.invite))
  } catch (e) {
    error.value = 'Could not join that list. The invite may have been used already.'
    console.error('[todomvc] join failed', e)
  } finally {
    busy.value = false
  }
}

function done (contractID = null) {
  clearInvite()
  emit('done', contractID)
}
</script>

<template>
  <section class="join">
    <h2>Someone shared a todo list with you</h2>
    <p>
      Joining asks the list for its keys. The person who shared it has to be
      online with this app open to answer, because their browser holds the keys
      and the server does not. Until they answer, the list is in your lists but
      empty.
    </p>
    <p v-if="error" class="join-error">{{ error }}</p>
    <button type="button" class="primary" :disabled="busy" @click="join">
      Join the list
    </button>
    <button type="button" class="link" @click="done">No thanks</button>
  </section>
</template>
