import { createApp } from 'vue'
import App from './components/App.vue'
import { startChelonia } from './chelonia/index.js'
import './style.css'

startChelonia()
  .catch((e) => {
    console.error('[todomvc] could not start Chelonia', e)
  })
  .finally(() => {
    createApp(App).mount('#app')
  })
