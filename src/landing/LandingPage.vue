<script setup>
/**
 * Landing page: project presentation shown at `#/` before entering the tool.
 *
 * Reuses the application design tokens/classes and the repository `/docs`
 * documentation. The tool itself lives at `#/tool` (see Root.vue).
 */
import { useI18n } from 'vue-i18n'
import { persistLocale } from '../i18n'

const { t, locale } = useI18n()
const emit = defineEmits(['open-tool'])

const REPO = 'https://github.com/rafaa-sf/l-sea-space-apps'
const DOCS_INDEX = `${REPO}/blob/main/docs/README.md`

const DOCS = [
  { key: 'challenge', path: 'docs/challenge.md', icon: '◎' },
  { key: 'architecture', path: 'docs/architecture.md', icon: '⌗' },
  { key: 'data', path: 'docs/data.md', icon: '◍' },
  { key: 'submission', path: 'docs/submission.md', icon: '✧' },
  { key: 'demo', path: 'docs/demo.md', icon: '▶' },
  { key: 'commercial', path: 'docs/commercial.md', icon: '◈' },
  { key: 'scalability', path: 'docs/scalability.md', icon: '↗' },
  { key: 'qa', path: 'docs/qa.md', icon: '✓' },
  { key: 'deployment', path: 'docs/deployment.md', icon: '☁' },
  { key: 'security', path: 'docs/security.md', icon: '⛨' },
  { key: 'aiUsage', path: 'docs/ai-usage.md', icon: '✳' },
  { key: 'contributing', path: 'docs/contributing.md', icon: '⚒' },
  { key: 'decisions', path: 'docs/decisions.md', icon: '⋮' },
  { key: 'miro', path: 'docs/miro.md', icon: '▦' },
]

function docUrl(path) {
  return `${REPO}/blob/main/${path}`
}

function setLocale(code) {
  locale.value = code
  persistLocale(code)
  try {
    document.documentElement.lang = code
  } catch {
    /* no DOM */
  }
}

function openDocsIndex() {
  window.open(DOCS_INDEX, '_blank', 'noopener')
}
</script>

<template>
  <div class="landing">
    <header class="landing__bar">
      <div class="landing__brand">
        <span class="brand-mark" aria-hidden="true" />
        <span class="brand-wordmark">L-SEA</span>
        <span class="brand-product">{{ t('landing.title') }}</span>
      </div>
      <div class="landing__bar-right">
        <span class="chip">{{ t('landing.badge') }}</span>
        <div class="landing__lang" role="group" :aria-label="t('landing.languageLabel')">
          <button
            v-for="code in ['en', 'es']"
            :key="code"
            type="button"
            class="landing__lang-button"
            :class="{ 'is-active': locale === code }"
            :aria-pressed="locale === code"
            @click="setLocale(code)"
          >
            {{ code.toUpperCase() }}
          </button>
        </div>
      </div>
    </header>

    <main class="landing__main">
      <section class="landing__hero" :aria-label="t('landing.title')">
        <div class="landing__hero-text">
          <p class="landing__badges">
            <span class="chip chip--ok">{{ t('landing.badge') }}</span>
            <span class="chip">{{ t('landing.challengeBadge') }}</span>
          </p>
          <h1 class="landing__title">{{ t('landing.title') }}</h1>
          <p class="landing__subtitle">{{ t('landing.subtitle') }}</p>
          <div class="landing__actions">
            <button type="button" class="button button--primary landing__cta" @click="emit('open-tool')">
              {{ t('landing.cta') }} <span aria-hidden="true">→</span>
            </button>
            <button type="button" class="button button--quiet" @click="openDocsIndex">
              {{ t('landing.docsCta') }}
            </button>
          </div>
          <p class="landing__cta-hint">{{ t('landing.ctaHint') }}</p>
        </div>
      </section>

      <section class="landing__stats" :aria-label="t('landing.stats.data')">
        <div class="landing__stat">
          <strong>{{ t('landing.stats.data') }}</strong>
          <span>{{ t('landing.stats.dataNote') }}</span>
        </div>
        <div class="landing__stat">
          <strong>{{ t('landing.stats.languages') }}</strong>
          <span>{{ t('landing.stats.languagesNote') }}</span>
        </div>
        <div class="landing__stat">
          <strong>{{ t('landing.stats.tested') }}</strong>
          <span>{{ t('landing.stats.testedNote') }}</span>
        </div>
      </section>

      <section class="landing__section" :aria-label="t('landing.howto.title')">
        <h2 class="landing__h2">{{ t('landing.howto.title') }}</h2>
        <ol class="landing__steps">
          <li v-for="n in 3" :key="n" class="landing__step">
            <span class="landing__step-num" aria-hidden="true">{{ n }}</span>
            <div>
              <h3>{{ t(`landing.howto.s${n}t`) }}</h3>
              <p>{{ t(`landing.howto.s${n}b`) }}</p>
            </div>
          </li>
        </ol>
      </section>

      <section class="landing__section" :aria-label="t('landing.challenge.title')">
        <h2 class="landing__h2">{{ t('landing.challenge.title') }}</h2>
        <div class="landing__two-col">
          <p class="landing__lead">{{ t('landing.challenge.body') }}</p>
          <ul class="landing__list">
            <li>{{ t('landing.challenge.p1') }}</li>
            <li>{{ t('landing.challenge.p2') }}</li>
            <li>{{ t('landing.challenge.p3') }}</li>
          </ul>
        </div>
      </section>

      <section class="landing__section" :aria-label="t('landing.features.title')">
        <h2 class="landing__h2">{{ t('landing.features.title') }}</h2>
        <div class="landing__grid landing__grid--features">
          <article class="landing__card">
            <span class="landing__card-icon" aria-hidden="true">◎</span>
            <h3>{{ t('landing.features.f1t') }}</h3>
            <p>{{ t('landing.features.f1b') }}</p>
          </article>
          <article class="landing__card">
            <span class="landing__card-icon" aria-hidden="true">☀</span>
            <h3>{{ t('landing.features.f2t') }}</h3>
            <p>{{ t('landing.features.f2b') }}</p>
          </article>
          <article class="landing__card">
            <span class="landing__card-icon" aria-hidden="true">⚡</span>
            <h3>{{ t('landing.features.f3t') }}</h3>
            <p>{{ t('landing.features.f3b') }}</p>
          </article>
          <article class="landing__card">
            <span class="landing__card-icon" aria-hidden="true">✦</span>
            <h3>{{ t('landing.features.f4t') }}</h3>
            <p>{{ t('landing.features.f4b') }}</p>
          </article>
        </div>
      </section>

      <section class="landing__section" :aria-label="t('landing.data.title')">
        <h2 class="landing__h2">{{ t('landing.data.title') }}</h2>
        <div class="landing__grid landing__grid--three">
          <article class="landing__card">
            <h3>{{ t('landing.data.d1t') }}</h3>
            <p>{{ t('landing.data.d1b') }}</p>
          </article>
          <article class="landing__card">
            <h3>{{ t('landing.data.d2t') }}</h3>
            <p>{{ t('landing.data.d2b') }}</p>
          </article>
          <article class="landing__card">
            <h3>{{ t('landing.data.d3t') }}</h3>
            <p>{{ t('landing.data.d3b') }}</p>
          </article>
        </div>
      </section>

      <section class="landing__section" :aria-label="t('landing.impact.title')">
        <h2 class="landing__h2">{{ t('landing.impact.title') }}</h2>
        <div class="landing__two-col landing__two-col--cards">
          <article class="landing__card">
            <h3>{{ t('landing.impact.i1t') }}</h3>
            <p>{{ t('landing.impact.i1b') }}</p>
          </article>
          <article class="landing__card">
            <h3>{{ t('landing.impact.i2t') }}</h3>
            <p>{{ t('landing.impact.i2b') }}</p>
          </article>
        </div>
        <p class="landing__section-link">
          <a :href="docUrl('docs/scalability.md')" target="_blank" rel="noopener noreferrer">
            {{ t('landing.impact.link') }} <span aria-hidden="true">↗</span>
          </a>
        </p>
      </section>

      <section class="landing__section" :aria-label="t('landing.docs.title')">
        <h2 class="landing__h2">{{ t('landing.docs.title') }}</h2>
        <p class="landing__lead">{{ t('landing.docs.subtitle') }}</p>
        <div class="landing__grid landing__grid--docs">
          <a
            v-for="doc in DOCS"
            :key="doc.key"
            class="landing__doc"
            :href="docUrl(doc.path)"
            target="_blank"
            rel="noopener noreferrer"
          >
            <span class="landing__doc-icon" aria-hidden="true">{{ doc.icon }}</span>
            <span class="landing__doc-label">{{ t(`landing.docs.${doc.key}`) }}</span>
          </a>
        </div>
        <p class="landing__section-link">
          <a :href="DOCS_INDEX" target="_blank" rel="noopener noreferrer">
            {{ t('landing.docs.open') }} <span aria-hidden="true">↗</span>
          </a>
        </p>
      </section>
    </main>

    <footer class="landing__footer">
      <span>{{ t('landing.footer.built') }}</span>
      <span class="landing__footer-links">
        <a :href="REPO" target="_blank" rel="noopener noreferrer">{{ t('landing.footer.repo') }}</a>
        <a :href="docUrl('docs/ai-usage.md')" target="_blank" rel="noopener noreferrer">{{ t('landing.footer.ai') }}</a>
        <a href="https://rafaa-sf.github.io/l-sea-space-apps/" target="_blank" rel="noopener noreferrer">{{ t('landing.footer.live') }}</a>
      </span>
    </footer>
  </div>
</template>

<style scoped>
.landing {
  min-height: 100vh;
  overflow-x: hidden;
  background:
    radial-gradient(1200px 600px at 80% -10%, rgba(91, 141, 239, 0.12), transparent 60%),
    radial-gradient(900px 500px at 0% 100%, rgba(216, 177, 86, 0.06), transparent 60%),
    var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-ui);
}

.landing__bar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 20px;
  border-bottom: 1px solid var(--color-border);
  background: rgba(13, 16, 22, 0.92);
  backdrop-filter: blur(8px);
}

.landing__brand {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.landing__bar-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.landing__lang {
  display: inline-flex;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.landing__lang-button {
  border: 0;
  padding: 4px 8px;
  background: transparent;
  color: var(--color-text-dim);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.landing__lang-button.is-active {
  background: var(--color-accent-soft);
  color: var(--color-accent-strong);
}

.landing__main {
  width: min(1120px, 100% - 40px);
  margin: 0 auto;
  padding: 40px 0 8px;
}

.landing__hero {
  padding: 24px 0 12px;
}

.landing__badges {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0 0 14px;
}

.landing__title {
  margin: 0;
  font-size: clamp(30px, 4.6vw, 52px);
  line-height: 1.06;
  letter-spacing: -0.02em;
}

.landing__subtitle {
  max-width: 62ch;
  margin: 14px 0 0;
  color: var(--color-text-dim);
  font-size: clamp(16px, 1.5vw, 18px);
  line-height: 1.55;
}

.landing__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 22px;
}

.landing__cta {
  font-size: 15px;
  padding: 10px 18px;
}

.landing__cta-hint {
  margin: 10px 0 0;
  color: var(--color-text-faint);
  font-size: 12px;
}

.landing__stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin: 28px 0 8px;
}

.landing__stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 14px 16px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  background: var(--color-surface);
}

.landing__stat strong {
  font-size: 14px;
}

.landing__stat span {
  color: var(--color-text-dim);
  font-size: 12px;
}

.landing__section {
  padding: 34px 0 6px;
}

.landing__h2 {
  margin: 0 0 16px;
  font-size: clamp(18px, 2.2vw, 24px);
  letter-spacing: -0.01em;
}

.landing__two-col {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
  gap: 22px;
  align-items: start;
}

.landing__two-col--cards {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.landing__lead {
  margin: 0;
  color: var(--color-text-dim);
  font-size: 16px;
  line-height: 1.6;
}

.landing__list {
  margin: 0;
  padding-left: 18px;
  color: var(--color-text-dim);
  line-height: 1.6;
}

.landing__list li + li {
  margin-top: 8px;
}

.landing__grid {
  display: grid;
  gap: 12px;
}

.landing__grid--features {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.landing__grid--three {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.landing__card {
  padding: 16px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  background: var(--color-surface);
}

.landing__card h3 {
  margin: 0 0 8px;
  font-size: 14px;
}

.landing__card p {
  margin: 0;
  color: var(--color-text-dim);
  font-size: 13px;
  line-height: 1.55;
}

.landing__card-icon {
  display: inline-block;
  margin-bottom: 10px;
  color: var(--color-accent-strong);
  font-size: 16px;
}

.landing__grid--docs {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.landing__doc {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text);
  font-size: 12.5px;
  text-decoration: none;
  transition: border-color 120ms ease, background 120ms ease;
}

.landing__doc:hover {
  border-color: var(--color-border-strong);
  background: rgba(91, 141, 239, 0.08);
}

.landing__doc:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

.landing__doc-icon {
  color: var(--color-text-faint);
}

.landing__section-link {
  margin: 14px 0 0;
  font-size: 13px;
}

.landing__section-link a,
.landing__footer-links a {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
}

.landing__section-link a {
  color: var(--color-accent-strong);
  text-decoration: none;
}

.landing__section-link a:hover {
  text-decoration: underline;
}

.landing__footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: min(1120px, 100% - 40px);
  margin: 40px auto 0;
  padding: 18px 0 26px;
  border-top: 1px solid var(--color-border);
  color: var(--color-text-faint);
  font-size: 12px;
}

.landing__footer-links {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
}

.landing__footer-links a {
  color: var(--color-text-dim);
  text-decoration: none;
}

.landing__footer-links a:hover {
  color: var(--color-text);
  text-decoration: underline;
}

.landing__steps {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.landing__step {
  display: flex;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius);
  background: var(--color-surface);
}

.landing__step-num {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--color-accent-soft);
  color: var(--color-accent-strong);
  font-weight: 700;
  font-size: 14px;
}

.landing__step h3 {
  margin: 0 0 6px;
  font-size: 16px;
}

.landing__step p {
  margin: 0;
  color: var(--color-text-dim);
  font-size: 16px;
  line-height: 1.5;
}

@media (max-width: 1024px) {
  .landing__grid--features,
  .landing__grid--docs {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .landing__main {
    width: min(1120px, 100% - 24px);
    padding-top: 20px;
  }

  .landing__stats {
    grid-template-columns: 1fr;
  }

  .landing__two-col,
  .landing__two-col--cards,
  .landing__grid--three,
  .landing__steps {
    grid-template-columns: 1fr;
  }

  .landing__grid--features,
  .landing__grid--docs {
    grid-template-columns: 1fr;
  }

  .landing__bar {
    padding: 10px 12px;
  }

  .landing__bar-right .chip {
    display: none;
  }
}
</style>
