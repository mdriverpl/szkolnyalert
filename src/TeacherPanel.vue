<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { ShieldCheck, ShieldAlert, Radio, MapPin, Clock3, Download, WifiOff, CheckCircle2, X, ArrowRight, LogOut, KeyRound, LoaderCircle } from 'lucide-vue-next';

const data = ref(null), loading = ref(true), connected = ref(false), needsKey = ref(false), error = ref(''), accessKey = ref('');
const launchOpen = ref(false), selectedAlert = ref(''), location = ref(''), sending = ref(false), launchError = ref('');
const installHelp = ref(false), installPrompt = ref(null), standalone = ref(false);
const launchDialog = ref(null);
let previousFocus;
watch(launchOpen, async open => {
  if (open) { previousFocus = document.activeElement; await nextTick(); launchDialog.value?.querySelector('select')?.focus(); }
  else previousFocus?.focus();
});
const active = computed(() => [...(data.value?.incidents || [])].sort((a,b) => (a.severity === 'critical' ? 0 : 1) - (b.severity === 'critical' ? 0 : 1) || b.createdAt.localeCompare(a.createdAt)));
const availableAlerts = computed(() => (data.value?.alerts || []).filter(alert => !active.value.some(event => event.alertId === alert.id)));
const level = value => ({ critical: 'POWAŻNY ALERT', warning: 'ALERT OSTRZEGAWCZY', info: 'KOMUNIKAT' }[value]);
const date = value => new Date(value).toLocaleString('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
let interval, requestVersion = 0;
async function api(path, options = {}) {
  const response = await fetch('/api/teacher-panel' + path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers }, signal: AbortSignal.timeout(12000) });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401) { needsKey.value = true; data.value = null; launchOpen.value = false; }
    throw Object.assign(new Error(result.error || 'Nie udało się wykonać operacji.'), { status: response.status });
  }
  return result;
}
async function refresh() {
  const version = ++requestVersion;
  try {
    const result = await api('/state');
    if (version === requestVersion) { data.value = result; connected.value = true; needsKey.value = false; error.value = ''; }
  } catch (e) { if (version === requestVersion) { connected.value = false; error.value = e.status ? e.message : 'Brak połączenia z serwerem. Dane na ekranie mogą być nieaktualne.'; } }
}
async function initialize() {
  loading.value = true; error.value = '';
  const key = accessKey.value.trim() || new URLSearchParams(window.location.hash.slice(1)).get('klucz');
  try {
    if (key) {
      await api('/access', { method: 'POST', body: JSON.stringify({ key }) });
      window.history.replaceState(null, '', window.location.pathname);
      accessKey.value = ''; needsKey.value = false;
    }
    await refresh();
  } catch (e) { error.value = e.status ? e.message : 'Brak połączenia. Spróbuj ponownie po odzyskaniu internetu.'; connected.value = false; }
  finally { loading.value = false; }
}
function openLaunch() {
  selectedAlert.value = availableAlerts.value[0]?.id || ''; location.value = ''; launchError.value = ''; launchOpen.value = true;
}
async function launch() {
  if (!connected.value || !selectedAlert.value || sending.value) return;
  sending.value = true; launchError.value = '';
  try {
    const event = await api('/incidents', { method: 'POST', body: JSON.stringify({ alertId: selectedAlert.value, location: location.value }) });
    requestVersion++;
    if (data.value && !data.value.incidents.some(x => x.id === event.id)) data.value.incidents.unshift(event);
    launchOpen.value = false; await refresh();
  } catch (e) { launchError.value = e.status ? e.message : 'Nie udało się potwierdzić uruchomienia. Odśwież panel i sprawdź aktywne alerty przed kolejną próbą.'; await refresh(); }
  finally { sending.value = false; }
}
async function logout() {
  try { await api('/logout', { method: 'POST' }); data.value = null; needsKey.value = true; connected.value = false; }
  catch (e) { error.value = e.message; }
}
function captureInstall(event) { event.preventDefault(); installPrompt.value = event; }
function installed() { standalone.value = true; installPrompt.value = null; installHelp.value = false; }
async function install() {
  if (!installPrompt.value) { installHelp.value = !installHelp.value; return; }
  await installPrompt.value.prompt();
  const choice = await installPrompt.value.userChoice;
  if (choice.outcome === 'accepted') installed();
  installPrompt.value = null;
}
function resume() { if (document.visibilityState !== 'hidden') { if (data.value) refresh(); else if (!needsKey.value) initialize(); } }
function offline() { connected.value = false; error.value = 'Brak internetu. Wyświetlane dane mogą być nieaktualne. Uruchamianie alertów jest niedostępne.'; }
function escape(event) {
  if (event.key === 'Escape' && !sending.value) launchOpen.value = false;
  if (event.key === 'Tab' && launchOpen.value && launchDialog.value) {
    const fields = [...launchDialog.value.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled)')];
    const first = fields[0], last = fields.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
}
onMounted(() => {
  standalone.value = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
  initialize();
  interval = setInterval(() => { if (data.value && !needsKey.value && document.visibilityState !== 'hidden') refresh(); }, 3000);
  window.addEventListener('online', resume); window.addEventListener('offline', offline);
  document.addEventListener('visibilitychange', resume); window.addEventListener('beforeinstallprompt', captureInstall);
  window.addEventListener('appinstalled', installed); window.addEventListener('keydown', escape);
});
onUnmounted(() => {
  clearInterval(interval); requestVersion++;
  window.removeEventListener('online', resume); window.removeEventListener('offline', offline); document.removeEventListener('visibilitychange', resume);
  window.removeEventListener('beforeinstallprompt', captureInstall); window.removeEventListener('appinstalled', installed); window.removeEventListener('keydown', escape);
});
</script>

<template>
  <div class="teacher-app">
    <header class="teacher-header"><a class="brand" href="/nauczyciel"><ShieldCheck :size="27"/><span>szkolny<span class="brand-light">alert</span><small>OSOBISTY PANEL NAUCZYCIELA</small></span></a><button v-if="data" class="teacher-logout" aria-label="Wyloguj panel nauczyciela" @click="logout"><LogOut :size="19"/></button></header>
    <main class="teacher-main">
      <div v-if="loading" class="teacher-loading"><LoaderCircle class="spin" :size="30"/><p>Otwieranie Twojego panelu…</p></div>
      <section v-else-if="!data" class="teacher-access panel"><KeyRound :size="35"/><h1>Twój osobisty panel.</h1><p>Otwórz link otrzymany od szkoły albo wpisz swój klucz dostępu.</p><p v-if="error" class="error" role="alert">{{ error }}</p><form @submit.prevent="initialize"><label>Klucz nauczyciela<input v-model="accessKey" type="password" required maxlength="64" autocomplete="off" spellcheck="false" placeholder="Klucz z linku od szkoły"></label><button class="btn primary full">Otwórz mój panel <ArrowRight :size="17"/></button></form><button v-if="!needsKey" class="text-link" @click="initialize">Spróbuj połączyć ponownie</button></section>
      <template v-else>
        <section class="teacher-identity"><span class="eyebrow">{{ data.school.name }}</span><h1>{{ data.teacher.name }}</h1><p>{{ data.teacher.subject }}</p><div class="teacher-connection"><span :class="['status-dot', { orange: !connected }]"></span>{{ connected ? 'Połączono ze szkołą' : 'Brak aktualnego połączenia' }}<span v-if="data.checkedAt">· {{ date(data.checkedAt) }}</span></div></section>
        <div v-if="!connected" class="teacher-offline" role="alert"><WifiOff :size="22"/><div><strong>Dane mogą być nieaktualne</strong><p>{{ error }}</p><button class="text-link" @click="refresh">Sprawdź połączenie</button></div></div>
        <div v-if="active.length" class="teacher-alerts">
          <article v-for="event in active" :key="event.id" :class="['teacher-emergency', event.severity]" role="region" :aria-label="event.name">
            <div class="teacher-emergency-heading"><ShieldAlert :size="32"/><div><span>{{ level(event.severity) }}</span><h2>{{ event.name }}</h2></div></div>
            <p v-if="event.isDemo" class="teacher-drill">ĆWICZENIE · SCENARIUSZ DEMONSTRACYJNY</p>
            <div class="teacher-event-meta"><span><MapPin :size="16"/>{{ event.location }}</span><span><Clock3 :size="15"/>{{ date(event.createdAt) }}</span></div>
            <div v-if="event.procedure" class="teacher-safety-procedure"><span class="eyebrow">PROCEDURA BEZPIECZEŃSTWA</span><h3>{{ event.procedure.name }}</h3><p class="teacher-procedure-description">{{ event.procedure.description }}</p><ol><li v-for="(step, i) in event.procedure.steps" :key="i"><span>{{ i + 1 }}</span><p>{{ step }}</p></li></ol></div>
            <p class="teacher-emergency-note">Postępuj zgodnie z procedurą szkoły i poleceniami koordynatora. Zakończenie alertu potwierdza administrator.</p>
          </article>
        </div>
        <section v-else :class="['teacher-calm panel', { stale: !connected }]"><CheckCircle2 :size="37"/><h2>{{ connected ? 'Brak aktywnych alertów' : 'Nie można potwierdzić bieżącego stanu' }}</h2><p>{{ connected ? 'Procedura bezpieczeństwa pojawi się tutaj automatycznie po uruchomieniu alertu w Twojej szkole.' : 'Ostatni odczyt nie zawierał aktywnych alertów. Odzyskaj połączenie, aby sprawdzić aktualną sytuację.' }}</p></section>
        <section class="teacher-launch"><button class="teacher-alert-button" :disabled="!connected || !availableAlerts.length" @click="openLaunch"><Radio :size="29"/><span>URUCHOM ALERT<small>Zgłoś zdarzenie w swojej szkole</small></span><ArrowRight :size="23"/></button><p v-if="!availableAlerts.length">{{ data.alerts.length ? 'Wszystkie zdefiniowane alerty są już aktywne.' : 'Administrator nie zdefiniował jeszcze alertów.' }}</p><p v-else>W następnym kroku wybierzesz rodzaj alertu i miejsce zdarzenia.</p></section>
        <section class="teacher-install"><div><Download :size="22"/><span><strong>{{ standalone ? 'Aplikacja jest zainstalowana' : 'Miej swój panel zawsze pod ręką' }}</strong><small>Twój link jest osobisty. Nie przekazuj go innym osobom.</small></span></div><button v-if="!standalone" class="btn secondary" @click="install">Zainstaluj aplikację</button><div v-if="installHelp" class="teacher-install-help"><p><strong>Android:</strong> w menu przeglądarki wybierz „Zainstaluj aplikację” lub „Dodaj do ekranu głównego”.</p><p><strong>iPhone:</strong> otwórz link w Safari → Udostępnij → Do ekranu początkowego.</p><p>Instalacja na telefonie wymaga udostępnienia aplikacji przez HTTPS.</p></div></section>
      </template>
    </main>
    <footer class="teacher-footer">Szkolny Alert · Panel nauczyciela<span>Aktualizacja co 3 sekundy przy otwartym panelu</span></footer>
    <div v-if="launchOpen" class="modal-backdrop" @click.self="!sending && (launchOpen = false)"><section ref="launchDialog" class="modal teacher-launch-modal" role="dialog" aria-modal="true" aria-labelledby="teacher-launch-title"><header><div><span class="eyebrow">POTWIERDZENIE ZDARZENIA</span><h2 id="teacher-launch-title">Uruchom alert w szkole</h2></div><button class="icon-button" aria-label="Zamknij" :disabled="sending" @click="launchOpen = false"><X :size="22"/></button></header><form @submit.prevent="launch"><label>Rodzaj alertu<select v-model="selectedAlert" required :disabled="sending"><option v-for="alert in availableAlerts" :key="alert.id" :value="alert.id">{{ alert.name }}</option></select></label><label>Miejsce zdarzenia<input v-model="location" required maxlength="200" :disabled="sending" placeholder="np. Budynek A, sala 12" autofocus></label><p class="form-hint">Alert pojawi się w panelach nauczycieli Twojej szkoły. {{ data.smsGateway.enabled ? (data.smsGateway.testMode ? 'SMSAPI działa w trybie testowym, bez dostarczenia SMS-ów.' : 'Włączona jest rzeczywista wysyłka SMS do nauczycieli.') : 'Automatyczne SMS-y są wyłączone.' }}</p><p v-if="launchError" class="error" role="alert">{{ launchError }}</p><div class="modal-footer"><button type="button" class="btn secondary" :disabled="sending" @click="launchOpen = false">Anuluj</button><button class="btn danger" :disabled="sending || !connected || !selectedAlert">{{ sending ? 'Uruchamianie…' : 'Potwierdzam — uruchom ALERT' }}<Radio :size="17"/></button></div></form></section></div>
  </div>
</template>
