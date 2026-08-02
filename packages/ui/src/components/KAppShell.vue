<script setup>
defineProps({
  product: { type: String, default: 'Kindred' },
  subtitle: { type: String, default: 'Your library, your rules.' },
});
</script>

<template>
  <div class="k-shell">
    <aside class="k-shell__sidebar">
      <header class="k-shell__brand">
        <div class="k-shell__mark">K</div>
        <div>
          <strong>{{ product }}</strong>
          <span>{{ subtitle }}</span>
        </div>
      </header>
      <div class="k-shell__navigation"><slot name="navigation" /></div>
      <footer class="k-shell__sidebar-footer"><slot name="sidebar-footer" /></footer>
    </aside>
    <section class="k-shell__workspace">
      <header class="k-shell__topbar">
        <slot name="topbar" />
      </header>
      <main class="k-shell__main"><slot /></main>
    </section>
    <slot name="overlay" />
  </div>
</template>

<style scoped>
.k-shell { min-height: 100vh; display: grid; grid-template-columns: 224px minmax(0, 1fr); background: var(--k-bg); }
.k-shell__sidebar { position: sticky; top: 0; height: 100vh; display: flex; flex-direction: column; padding: 18px 12px; border-right: 1px solid var(--k-border); background: #121210; }
.k-shell__brand { display: grid; grid-template-columns: 34px 1fr; gap: 10px; align-items: center; padding: 0 7px 22px; }
.k-shell__mark { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 10px; background: var(--k-accent); color: var(--k-accent-ink); font-weight: 950; }
.k-shell__brand strong, .k-shell__brand span { display: block; }
.k-shell__brand strong { font-size: 14px; }
.k-shell__brand span { margin-top: 2px; color: var(--k-text-subtle); font-size: 10px; }
.k-shell__navigation { flex: 1; }
.k-shell__sidebar-footer { padding-top: 12px; border-top: 1px solid var(--k-border); }
.k-shell__workspace { min-width: 0; }
.k-shell__topbar { position: sticky; top: 0; z-index: 20; min-height: 64px; display: flex; align-items: center; padding: 0 28px; border-bottom: 1px solid var(--k-border); background: rgba(16,16,15,.88); backdrop-filter: blur(18px); }
.k-shell__main { padding: 26px 28px 48px; }
@media (max-width: 760px) {
  .k-shell { grid-template-columns: 1fr; }
  .k-shell__sidebar { display: none; }
  .k-shell__main { padding: 20px 16px 40px; }
  .k-shell__topbar { padding: 0 16px; }
}
</style>
