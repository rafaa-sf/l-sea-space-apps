<script setup>
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <div class="brand">
        <span class="brand-mark">L-SEA</span>
        <span class="brand-sub">{{ t('app.subtitle') }}</span>
      </div>
      <nav class="app-nav">
        <span class="badge">NASA Space Apps Málaga 2026</span>
      </nav>
    </header>

    <main class="app-main">
      <section class="placeholder">
        <h1>{{ t('app.title') }}</h1>
        <p>{{ t('app.placeholder') }}</p>
      </section>
    </main>

    <footer class="app-footer">
      <span>{{ t('app.footer') }}</span>
    </footer>
  </div>
</template>
