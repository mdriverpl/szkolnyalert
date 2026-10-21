<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { ShieldCheck, ShieldAlert, Radio, MapPin, Clock3, Download, WifiOff, CheckCircle2, X, ArrowRight, KeyRound, LoaderCircle, Bell } from 'lucide-vue-next';

const data = ref(null), loading = ref(true), connected = ref(false), needsKey = ref(false), error = ref(''), accessKey = ref('');
const launchOpen = ref(false), selectedAlert = ref(''), location = ref(''), sending = ref(false), launchError = ref('');
const sendSms = ref(false);
const installHelp = ref(false), installPrompt = ref(null), standalone = ref(false);
const samsungInternet = /SamsungBrowser\//i.test(navigator.userAgent);
const panelClosed = ref(false);
const pushStatus = ref('checking'), pushBusy = ref(false), pushMessage = ref('');
let pushRegistration, pushSubscription, pushPublicKey;
const pushSupported = () => window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
function pushKeyBytes(value) {
  const binary = window.atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}
async function loadPush() {
  if (!pushSupported()) { pushStatus.value = 'unsupported'; return; }
  try {
    const config = await api('/push');
    if (!config.enabled) { pushStatus.value = 'unconfigured'; return; }
    pushPublicKey = config.publicKey;
    // Do not request permission on load; permission is requested only on a tap.
    pushRegistration = await navigator.serviceWorker.getRegistration('/');
    if (!pushRegistration?.active) { pushStatus.value = 'loading-worker'; return; }
    pushSubscription = await pushRegistration.pushManager.getSubscription();
    if (window.Notification.permission === 'denied') { pushStatus.value = 'denied'; return; }
    if (pushSubscription && window.Notification.permission === 'granted') {
      const currentKey = pushSubscription.options?.applicationServerKey;
      if (currentKey && String(new Uint8Array(currentKey)) !== String(pushKeyBytes(pushPublicKey))) {
        await pushSubscription.unsubscribe(); pushSubscription = null;
      } else {
        await api('/push', { method: 'POST', body: JSON.stringify(pushSubscription) });
        pushStatus.value = 'subscribed'; return;
      }
    }
    pushStatus.value = 'ready';
  } catch { pushStatus.value = 'error'; pushMessage.value = 'Nie udało się sprawdzić powiadomień. Spróbuj ponownie.'; }
}
async function enablePush() {
  if (pushBusy.value || !pushRegistration || !pushPublicKey) return;
  pushBusy.value = true; pushMessage.value = '';
  try {
    const permission = await window.Notification.requestPermission();
    if (permission !== 'granted') { pushStatus.value = permission === 'denied' ? 'denied' : 'ready'; return; }
    pushSubscription = await pushRegistration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: pushKeyBytes(pushPublicKey) });
    await api('/push', { method: 'POST', body: JSON.stringify(pushSubscription) });
    pushStatus.value = 'subscribed'; pushMessage.value = 'Powiadomienia włączone na tym urządzeniu.';
  } catch { pushStatus.value = 'ready'; pushMessage.value = 'Nie udało się włączyć powiadomień. Sprawdź zgodę w ustawieniach telefonu i spróbuj ponownie.'; }
  finally { pushBusy.value = false; }
}
function pushWorkerMessage(event) {
  if (event.data?.type === 'refresh-alerts') {
    if (panelClosed.value) reopenPanel();
    else if (data.value) refresh();
  }
}
function leavePresence() {
  if (!data.value) return;
  try { navigator.sendBeacon?.('/api/teacher-panel/presence', new Blob([JSON.stringify({ active: false })], { type: 'application/json' })); }
  catch { /* Presence expires automatically if the browser cannot send the signal. */ }
}
function closePanel() {
  if (sending.value || pushBusy.value) return;
  leavePresence();
  panelClosed.value = true; launchOpen.value = false; requestVersion++;
  // Browsers may refuse to close a window they did not open. Keep a safe fallback.
  try { window.close(); } catch { /* The closed-panel screen remains visible. */ }
}
function reopenPanel() { panelClosed.value = false; initialize(); }
const launchDialog = ref(null);
let previousFocus;
watch(launchOpen, async open => {
  if (open) { previousFocus = document.activeElement; await nextTick(); launchDialog.value?.querySelector('select')?.focus(); }
  else previousFocus?.focus();
});
const active = computed(() => [...(data.value?.incidents || [])].sort((a,b) => Number(!!a.isTest) - Number(!!b.isTest) || (a.severity === 'critical' ? 0 : 1) - (b.severity === 'critical' ? 0 : 1) || b.createdAt.localeCompare(a.createdAt)));
const availableAlerts = computed(() => (data.value?.alerts || []).filter(alert => !active.value.some(event => event.alertId === alert.id)));
const level = value => ({ critical: 'POWAŻNY ALERT', warning: 'ALERT OSTRZEGAWCZY', info: 'KOMUNIKAT' }[value]);
const date = value => new Date(value).toLocaleString('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
let interval, requestVersion = 0;
const savedKeyName = 'szkolnyalert.teacherKey';
function savedKey() {
  try { return window.localStorage.getItem(savedKeyName) || ''; } catch { return ''; }
}
function rememberKey(key) {
  try {
    if (key) window.localStorage.setItem(savedKeyName, key);
    else window.localStorage.removeItem(savedKeyName);
  } catch { /* Access still works when browser storage is unavailable. */ }
}
async function api(path, options = {}) {
  const response = await fetch('/api/teacher-panel' + path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers }, signal: AbortSignal.timeout(12000) });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401) { needsKey.value = true; data.value = null; launchOpen.value = false; if (path === '/access') rememberKey(''); }
    throw Object.assign(new Error(result.error || 'Nie udało się wykonać operacji.'), { status: response.status });
  }
  return result;
}
async function refresh() {
  const version = ++requestVersion;
  try {
    let result;
    try { result = await api('/state'); }
    catch (e) {
      const key = savedKey();
      if (e.status !== 401 || !key) throw e;
      await api('/access', { method: 'POST', body: JSON.stringify({ key }) });
      result = await api('/state');
    }
    if (version === requestVersion) { data.value = result; connected.value = true; needsKey.value = false; error.value = ''; }
  } catch (e) { if (version === requestVersion) { connected.value = false; error.value = e.status ? e.message : 'Brak połączenia z serwerem. Dane na ekranie mogą być nieaktualne.'; } }
}
async function initialize() {
  loading.value = true; error.value = '';
  const key = accessKey.value.trim() || new URLSearchParams(window.location.hash.slice(1)).get('klucz') || savedKey();
  try {
    if (key) {
      await api('/access', { method: 'POST', body: JSON.stringify({ key }) });
      rememberKey(key);
      window.history.replaceState(null, '', window.location.pathname);
      accessKey.value = ''; needsKey.value = false;
    }
    await refresh();
    if (data.value) await loadPush();
  } catch (e) { error.value = e.status ? e.message : 'Brak połączenia. Spróbuj ponownie po odzyskaniu internetu.'; connected.value = false; }
  finally { loading.value = false; }
}
function openLaunch() {
  sendSms.value = !!data.value?.smsGateway.enabled;
  selectedAlert.value = availableAlerts.value[0]?.id || ''; location.value = ''; launchError.value = ''; launchOpen.value = true;
}
async function launch() {
  if (!connected.value || !selectedAlert.value || sending.value) return;
  sending.value = true; launchError.value = '';
  try {
    const event = await api('/incidents', { method: 'POST', body: JSON.stringify({ alertId: selectedAlert.value, location: location.value, sendSms: sendSms.value }) });
    requestVersion++;
    if (data.value && !data.value.incidents.some(x => x.id === event.id)) data.value.incidents.unshift(event);
    launchOpen.value = false; await refresh();
  } catch (e) { launchError.value = e.status ? e.message : 'Nie udało się potwierdzić uruchomienia. Odśwież panel i sprawdź aktywne alerty przed kolejną próbą.'; await refresh(); }
  finally { sending.value = false; }
}
function captureInstall(event) { event.preventDefault(); installPrompt.value = event; }
function installed() { standalone.value = true; installPrompt.value = null; installHelp.value = false; }
async function install() {
  if (samsungInternet) { installHelp.value = true; return; }
  if (!installPrompt.value) { installHelp.value = !installHelp.value; return; }
  await installPrompt.value.prompt();
  const choice = await installPrompt.value.userChoice;
  if (choice.outcome === 'accepted') installed();
  installPrompt.value = null;
}
function resume() { if (document.visibilityState === 'hidden') leavePresence(); if (!panelClosed.value && document.visibilityState !== 'hidden') { if (data.value) refresh(); else if (!needsKey.value) initialize(); } }
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
  navigator.serviceWorker?.addEventListener('message', pushWorkerMessage);
  standalone.value = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
  initialize();
  interval = setInterval(() => { if (!panelClosed.value && data.value && !needsKey.value && document.visibilityState !== 'hidden') refresh(); }, 3000);
  window.addEventListener('pagehide', leavePresence);
  window.addEventListener('online', resume); window.addEventListener('offline', offline);
  document.addEventListener('visibilitychange', resume); window.addEventListener('beforeinstallprompt', captureInstall);
  window.addEventListener('appinstalled', installed); window.addEventListener('keydown', escape);
});
onUnmounted(() => {
  navigator.serviceWorker?.removeEventListener('message', pushWorkerMessage);
  clearInterval(interval); requestVersion++;
  window.removeEventListener('pagehide', leavePresence);
  leavePresence();
  window.removeEventListener('online', resume); window.removeEventListener('offline', offline); document.removeEventListener('visibilitychange', resume);
  window.removeEventListener('beforeinstallprompt', captureInstall); window.removeEventListener('appinstalled', installed); window.removeEventListener('keydown', escape);
});
</script>

<template>
  <div class="teacher-app">
    <header class="teacher-header"><a class="brand" href="/nauczyciel"><ShieldCheck :size="27"/><span>szkolny<span class="brand-light">alert</span><small>OSOBISTY PANEL NAUCZYCIELA</small></span></a><button v-if="!panelClosed && data" class="teacher-close" :disabled="sending || pushBusy" aria-label="Zamknij panel bez wylogowania" @click="closePanel"><X :size="18"/><span>Zamknij</span></button></header>
    <main class="teacher-main">
      <section v-if="panelClosed" class="teacher-closed panel"><ShieldCheck :size="36"/><h1>Panel zamknięty.</h1><p>Możesz zamknąć to okno lub wrócić do panelu. Twój klucz pozostaje zapisany na tym urządzeniu. Włączone powiadomienia nadal działają.</p><button class="btn primary" @click="reopenPanel">Otwórz panel <ArrowRight :size="17"/></button></section>
      <div v-else-if="loading" class="teacher-loading"><LoaderCircle class="spin" :size="30"/><p>Otwieranie Twojego panelu…</p></div>
      <section v-else-if="!data" class="teacher-access panel"><KeyRound :size="35"/><h1>Twój osobisty panel.</h1><p>Otwórz link otrzymany od szkoły albo wpisz swój klucz dostępu.</p><p v-if="error" class="error" role="alert">{{ error }}</p><form @submit.prevent="initialize"><label>Klucz nauczyciela<input v-model="accessKey" type="password" required maxlength="64" autocomplete="off" spellcheck="false" placeholder="Klucz z linku od szkoły"></label><button class="btn primary full">Otwórz mój panel <ArrowRight :size="17"/></button></form><button v-if="!needsKey" class="text-link" @click="initialize">Spróbuj połączyć ponownie</button></section>
      <template v-else>
        <p v-if="standalone" class="teacher-installed-note"><CheckCircle2 :size="14"/>Aplikacja zainstalowana</p>
        <section v-else class="teacher-install"><div><Download :size="22"/><span><strong>Miej swój panel zawsze pod ręką</strong><small>Klucz zapamiętujemy na tym urządzeniu. Twój link jest osobisty — nie przekazuj go innym.</small></span></div><button class="btn secondary" @click="install">Zainstaluj aplikację</button><div v-if="installHelp || samsungInternet" class="teacher-install-help"><p v-if="samsungInternet"><strong>Samsung Internet:</strong> jeśli Play Protect blokuje instalację komunikatem o starszej wersji Androida, otwórz pełny osobisty link z SMS-a w aktualnym Google Chrome. W menu Chrome wybierz „Dodaj do ekranu głównego” → „Zainstaluj”. Chrome zapamięta klucz po otwarciu tego linku. Po instalacji włącz powiadomienia w aplikacji.</p><p v-else><strong>Android:</strong> w aktualnym Google Chrome otwórz swój osobisty link, a następnie w menu wybierz „Zainstaluj aplikację” lub „Dodaj do ekranu głównego”.</p><p><strong>iPhone:</strong> otwórz link w Safari → Udostępnij → Do ekranu początkowego.</p><p>Instalacja na telefonie wymaga udostępnienia aplikacji przez HTTPS.</p></div></section>
        <p v-if="pushStatus === 'subscribed'" class="teacher-push-enabled" role="status"><CheckCircle2 :size="14"/>Powiadomienia włączone</p>
        <section v-else class="teacher-push panel" aria-label="Powiadomienia telefonu"><div class="teacher-push-heading"><Bell :size="21"/><div><strong>Powiadomienia na telefonie</strong><p>Ogólny komunikat o alercie, także przy zamkniętej aplikacji. Szczegóły zobaczysz po jej otwarciu.</p></div></div><button v-if="pushStatus === 'ready'" class="btn primary" :disabled="pushBusy || !connected" @click="enablePush">Włącz powiadomienia</button><p v-if="pushStatus === 'denied'" class="teacher-push-help">Powiadomienia są zablokowane. Włącz je w ustawieniach telefonu lub przeglądarki dla Szkolnego Alertu, a potem otwórz aplikację ponownie.</p><p v-if="pushStatus === 'unsupported'" class="teacher-push-help">Na iPhonie otwórz aplikację z ikony na ekranie głównym (iOS 16.4 lub nowszy). Na Androidzie użyj aktualnej przeglądarki Chrome. Wymagane jest HTTPS.</p><p v-if="pushStatus === 'unconfigured'" class="teacher-push-help">Administrator musi skonfigurować powiadomienia na serwerze.</p><button v-if="['loading-worker', 'error'].includes(pushStatus)" class="text-link" :disabled="pushBusy" @click="loadPush">Sprawdź gotowość powiadomień</button><p v-if="pushStatus === 'loading-worker'" class="teacher-push-help">Trwa przygotowanie aplikacji. Odśwież ją lub sprawdź gotowość ponownie.</p><p v-if="pushMessage" class="teacher-push-help" role="status">{{ pushMessage }}</p></section>
        <section class="teacher-identity"><span class="eyebrow">{{ data.school.name }}</span><h1>{{ data.teacher.name }}</h1><p>{{ data.teacher.subject }}</p><div class="teacher-connection"><span :class="['status-dot', { orange: !connected }]"></span>{{ connected ? 'Połączono ze szkołą' : 'Brak aktualnego połączenia' }}<span v-if="data.checkedAt">· {{ date(data.checkedAt) }}</span></div></section>
        <div v-if="!connected" class="teacher-offline" role="alert"><WifiOff :size="22"/><div><strong>Dane mogą być nieaktualne</strong><p>{{ error }}</p><button class="text-link" @click="refresh">Sprawdź połączenie</button></div></div>
        <div v-if="active.length" class="teacher-alerts">
          <article v-for="event in active" :key="event.id" :class="['teacher-emergency', event.severity]" role="region" :aria-label="event.name">
            <div class="teacher-emergency-heading"><ShieldAlert :size="32"/><div><span>{{ level(event.severity) }}</span><h2>{{ event.name }}</h2></div></div>
            <p v-if="event.isTest" class="teacher-drill">ALERT TESTOWY · ĆWICZENIE SYSTEMU</p><p v-if="event.isDemo" class="teacher-drill">ĆWICZENIE · SCENARIUSZ DEMONSTRACYJNY</p>
            <div class="teacher-event-meta"><span><MapPin :size="16"/>{{ event.location }}</span><span><Clock3 :size="15"/>{{ date(event.createdAt) }}</span></div>
            <div v-if="event.procedure" class="teacher-safety-procedure"><span class="eyebrow">PROCEDURA BEZPIECZEŃSTWA</span><h3>{{ event.procedure.name }}</h3><p class="teacher-procedure-description">{{ event.procedure.description }}</p><ol><li v-for="(step, i) in event.procedure.steps" :key="i"><span>{{ i + 1 }}</span><p>{{ step }}</p></li></ol></div>
            <p class="teacher-emergency-note">Postępuj zgodnie z procedurą szkoły i poleceniami koordynatora. Zakończenie alertu potwierdza administrator.</p>
          </article>
        </div>
        <section v-else :class="['teacher-calm panel', { stale: !connected }]"><CheckCircle2 :size="37"/><h2>{{ connected ? 'Brak aktywnych alertów' : 'Nie można potwierdzić bieżącego stanu' }}</h2><p>{{ connected ? 'Procedura bezpieczeństwa pojawi się tutaj automatycznie po uruchomieniu alertu w Twojej szkole.' : 'Ostatni odczyt nie zawierał aktywnych alertów. Odzyskaj połączenie, aby sprawdzić aktualną sytuację.' }}</p></section>
        <section class="teacher-launch"><button class="teacher-alert-button" :disabled="!connected || !availableAlerts.length" @click="openLaunch"><Radio :size="29"/><span>URUCHOM ALERT<small>Zgłoś zdarzenie w swojej szkole</small></span><ArrowRight :size="23"/></button><p v-if="!availableAlerts.length">{{ data.alerts.length ? 'Wszystkie zdefiniowane alerty są już aktywne.' : 'Administrator nie zdefiniował jeszcze alertów.' }}</p><p v-else>W następnym kroku wybierzesz rodzaj alertu. Miejsce zdarzenia jest opcjonalne.</p></section>

      </template>
    </main>
    <footer class="teacher-footer">Szkolny Alert · Panel nauczyciela<span>Aktualizacja co 3 sekundy przy otwartym panelu</span></footer>
    <div v-if="launchOpen" class="modal-backdrop" @click.self="!sending && (launchOpen = false)"><section ref="launchDialog" class="modal teacher-launch-modal" role="dialog" aria-modal="true" aria-labelledby="teacher-launch-title"><header><div><span class="eyebrow">POTWIERDZENIE ZDARZENIA</span><h2 id="teacher-launch-title">Uruchom alert w szkole</h2></div><button class="icon-button" aria-label="Zamknij" :disabled="sending" @click="launchOpen = false"><X :size="22"/></button></header><form @submit.prevent="launch"><label>Rodzaj alertu<select v-model="selectedAlert" required :disabled="sending"><option v-for="alert in availableAlerts" :key="alert.id" :value="alert.id">{{ alert.isTest ? '[TEST] ' + alert.name : alert.name }}</option></select></label><p v-if="availableAlerts.find(a => a.id === selectedAlert)?.isTest" class="test-alert-notice">ALERT TESTOWY — ćwiczenie systemu. Powiadomienia będą oznaczone jako TEST. SMS-y w trybie rzeczywistym są płatne.</p><label>Miejsce zdarzenia (opcjonalnie)<input v-model="location" maxlength="200" :disabled="sending" placeholder="np. Budynek A, sala 12" autofocus></label><label class="sms-checkbox launch-sms-checkbox"><input v-model="sendSms" type="checkbox" :disabled="sending || !data.smsGateway.enabled"><span><strong>Wyślij SMS-y do wszystkich</strong><small>Do nauczycieli Twojej szkoły z poprawnym numerem telefonu. Odznacz, aby uruchomić sam alert.</small></span></label><p class="form-hint">Alert pojawi się w panelach nauczycieli Twojej szkoły. {{ data.smsGateway.enabled ? (data.smsGateway.testMode ? 'Bramka SMS działa w trybie testowym, bez dostarczenia SMS-ów.' : 'Zaznaczona opcja SMS uruchomi płatną wysyłkę.') : 'Wysyłka SMS jest wyłączona. Administrator może włączyć ją w ustawieniach szkoły.' }}</p><p v-if="launchError" class="error" role="alert">{{ launchError }}</p><div class="modal-footer"><button type="button" class="btn secondary" :disabled="sending" @click="launchOpen = false">Anuluj</button><button class="btn danger" :disabled="sending || !connected || !selectedAlert">{{ sending ? 'Uruchamianie…' : 'Potwierdzam — uruchom ALERT' }}<Radio :size="17"/></button></div></form></section></div>
  </div>
</template>
