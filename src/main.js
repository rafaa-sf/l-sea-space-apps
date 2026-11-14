import { createApp } from 'vue'
import Root from './Root.vue'
import i18n from './i18n'
import './styles/main.css'

const app = createApp(Root)

app.config.errorHandler = (error, instance, info) => {
  // Keep the mission console usable even if one component fails: log and move on.
  console.error('[lsea] UI error:', info, error)
}

app.use(i18n).mount('#app')
