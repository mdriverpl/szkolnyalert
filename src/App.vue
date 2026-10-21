<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { ShieldCheck, LayoutDashboard, Users, Building2, BookOpen, Bell, ChevronDown, ChevronRight, Plus, Search, ArrowUpRight, ArrowRight, Check, X, LogOut, Menu, Flame, HeartPulse, ShieldAlert, Clock3, CircleHelp, CheckCircle2, Pencil, Trash2, MapPin, Activity, Radio, LoaderCircle, Upload, Download, Settings, MessageSquare, Link, Copy, KeyRound } from 'lucide-vue-next';

const state = ref(null), loading = ref(true), busy = ref(false), error = ref(''), toast = ref(''), view = ref('dashboard'), schoolId = ref(''), query = ref(''), mobileMenu = ref(false), modal = ref(null), health = ref(null);
const credentials = reactive({ login: '', password: '' });
const authScreen = ref('login');
const registration = reactive({ name: '', username: '', password: '' });
const canManage = computed(() => state.value?.user.role === 'admin');
const form = reactive({});
const csvImport = reactive({ file: null, filename: '', encoding: 'utf-8', text: '', preview: null });
const smsForm = reactive({ provider: 'smsapi', token: '', enabled: false, testMode: true, sender: '', hasToken: false, recipients: 0 });
const smsBusy = ref(false), smsError = ref(''), savedSms = ref(null), smsTestPhone = ref(''), smsTestResult = ref(null);
const smsDirty = computed(() => !savedSms.value || !!smsForm.token || smsForm.provider !== savedSms.value.provider || smsForm.sender !== savedSms.value.sender || smsForm.enabled !== savedSms.value.enabled || smsForm.testMode !== savedSms.value.testMode);
watch(view, value => { if (value === 'settings') loadSmsSettings(); });
function applySmsSettings(data) { Object.assign(smsForm, data, { token: '' }); savedSms.value = { ...data }; smsTestResult.value = data.lastTest || null; }
async function loadSmsSettings() {
  smsBusy.value = true; smsError.value = '';
  try { applySmsSettings(await api('/settings/sms')); }
  catch (e) { smsError.value = e.message; } finally { smsBusy.value = false; }
}
async function saveSmsSettings() {
  smsBusy.value = true; smsError.value = '';
  try { applySmsSettings(await api('/settings/sms', { method: 'PUT', body: JSON.stringify({ provider: smsForm.provider, enabled: smsForm.enabled, testMode: smsForm.testMode, sender: smsForm.sender, token: smsForm.token }) })); await refresh(); notify('Zapisano ustawienia SMS.'); }
  catch (e) { smsError.value = e.message; } finally { smsBusy.value = false; }
}
async function testSms() {
  if (smsDirty.value) return;
  smsBusy.value = true; smsError.value = ''; smsTestResult.value = null;
  try { smsTestResult.value = await api('/settings/sms/test', { method: 'POST', body: JSON.stringify({ phone: smsTestPhone.value }) }); }
  catch (e) { smsError.value = e.message; } finally { smsBusy.value = false; }
}
async function removeSmsToken() {
  smsBusy.value = true; smsError.value = '';
  try { applySmsSettings(await api('/settings/sms', { method: 'DELETE' })); await refresh(); notify('Usunięto token i wyłączono automatyczne SMS-y.'); }
  catch (e) { smsError.value = e.message; } finally { smsBusy.value = false; }
}
const smsStatus = event => ({ disabled: 'SMS: wyłączone', pending: 'SMS: oczekuje na wysyłkę', sending: 'SMS: wysyłka rozpoczęta — sprawdź wynik u operatora', no_recipients: 'SMS: brak numerów odbiorców', test: 'SMS: tryb testowy, bez dostarczenia', accepted: `SMS: przyjęto do wysyłki (${event.sms?.accepted || 0})`, partial: `SMS: przyjęto ${event.sms?.accepted || 0} z ${event.sms?.total || 0}`, failed: 'SMS: błąd wysyłki', unknown: 'SMS: wynik nieznany — sprawdź panel operatora' }[event.sms?.status] || '');
const dialog = ref(null);
const teacherLink = ref(''), teacherKey = ref(''), accessCopied = ref(false);
const linkSmsPreview = ref(null), linkSmsResult = ref(null), linkSmsAttempted = ref(false);
async function openLinkSms(teacher = null) {
  linkSmsPreview.value = null; linkSmsResult.value = null; linkSmsAttempted.value = false;
  open('teachers', teacher, 'bulk-links'); busy.value = true;
  try { linkSmsPreview.value = await api('/teachers/link-sms/preview', { method: 'POST', body: JSON.stringify({ teacherId: teacher?.id ?? null }) }); }
  catch (e) { error.value = e.message; } finally { busy.value = false; }
}
async function sendTeacherLinks() {
  if (busy.value || linkSmsAttempted.value || !linkSmsPreview.value?.canSend) return;
  busy.value = true; error.value = ''; linkSmsAttempted.value = true;
  try {
    linkSmsResult.value = await api('/teachers/link-sms/send', { method: 'POST', body: JSON.stringify({ batchId: linkSmsPreview.value.batchId, expectedCount: linkSmsPreview.value.count, confirmed: true }) });
    await refresh();
  } catch (e) { error.value = `${e.message} Jeśli wysyłka się rozpoczęła, sprawdź panel operatora przed ponowieniem.`; }
  finally { busy.value = false; }
}
let previousFocus;
watch(modal, async value => {
  if (value) {
    previousFocus = document.activeElement;
    await nextTick();
    (dialog.value?.querySelector('input, textarea, select') || dialog.value?.querySelector('button'))?.focus();
    if (value.mode === 'access') {
      busy.value = true;
      try {
        const access = await api(`/teachers/${value.record.id}/panel-key`);
        if (access.path) { teacherLink.value = new URL(access.path, window.location.origin).href; teacherKey.value = access.key; }
      } catch (e) { error.value = e.message; } finally { busy.value = false; }
    }
  } else { previousFocus?.focus(); teacherLink.value = ''; teacherKey.value = ''; accessCopied.value = false; }
});
function dialogKeys(event) {
  if (event.key === 'Escape') { close(); return; }
  if (event.key !== 'Tab') return;
  const elements = [...dialog.value.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]')];
  const first = elements[0], last = elements.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
}
const nav = computed(() => [{ id: 'dashboard', label: 'Pulpit', icon: LayoutDashboard }, { id: 'teachers', label: 'Nauczyciele', icon: Users }, { id: 'alerts', label: 'Alerty', icon: Bell }, { id: 'procedures', label: 'Procedury', icon: BookOpen }, { id: 'history', label: 'Historia zdarzeń', icon: Clock3 }, { id: 'schools', label: 'Moja szkoła', icon: Building2 }, ...(canManage.value ? [{ id: 'users', label: 'Użytkownicy', icon: ShieldCheck }, { id: 'settings', label: 'Ustawienia', icon: Settings }] : [])]);
const school = computed(() => state.value?.schools.find(s => s.id === schoolId.value));
const scoped = type => state.value?.[type].filter(x => x.schoolId === schoolId.value) || [];
const teachers = computed(() => scoped('teachers')), procedures = computed(() => scoped('procedures')), alerts = computed(() => scoped('alerts')), incidents = computed(() => scoped('incidents'));
const active = computed(() => incidents.value.filter(x => x.status === 'active'));
const priorityIncident = computed(() => active.value.find(x => x.severity === 'critical') || active.value[0]);
const hasCritical = computed(() => active.value.some(x => x.severity === 'critical'));
const counts = computed(() => ({ teachers: teachers.value.length, alerts: alerts.value.length, procedures: procedures.value.length, users: state.value?.users.length || 0 }));
const titles = { dashboard: 'Spokojny dzień zaczyna się od przygotowania.', teachers: 'Ludzie, którzy dbają o bezpieczeństwo.', alerts: 'Właściwa reakcja zaczyna się tutaj.', procedures: 'Jasne zasady. Pewne działanie.', history: 'Każde zdarzenie w jednym miejscu.', schools: 'Dane placówki przypisanej do Twojego konta.', users: 'Konta z dostępem wyłącznie do Twojej szkoły.', settings: 'Bramka SMS i powiadomienia Twojej szkoły.' };
const list = computed(() => {
  let items = view.value === 'schools' ? state.value?.schools || [] : view.value === 'history' ? incidents.value : scoped(view.value);
  const q = query.value.toLocaleLowerCase('pl'); return items.filter(x => `${x.name} ${x.username || ''} ${x.email || ''} ${x.phone || ''} ${x.city || ''} ${x.description || ''}`.toLocaleLowerCase('pl').includes(q));
});
const level = value => ({ critical: 'Poważny', warning: 'Ostrzegawczy', info: 'Informacyjny' }[value]);
const alertIcon = value => value.name?.toLowerCase().includes('pożar') ? Flame : value.severity === 'warning' ? HeartPulse : ShieldAlert;
const date = value => new Date(value).toLocaleString('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const initials = name => name.split(' ').filter(Boolean).map(x => x[0]).slice(0, 2).join('');
const today = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
let timer, toastTimer;
async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  const data = await response.json();
  if (!response.ok) { if (response.status === 401 && path !== '/login') { state.value = null; modal.value = null; schoolId.value = ''; } throw Object.assign(new Error(data.error || 'Nie udało się wykonać operacji.'), { preview: data.preview }); }
  return data;
}
function notify(message) { toast.value = message; clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.value = '', 4500); }
async function refresh() {
  const data = await api('/state');
  if (data.user.id !== state.value?.user.id) { view.value = 'dashboard'; query.value = ''; }
  state.value = data;
  schoolId.value = data.user.schoolId;
}
async function login() {
  busy.value = true; error.value = '';
  try { await api('/login', { method: 'POST', body: JSON.stringify(credentials) }); await refresh(); credentials.password = ''; }
  catch (e) { error.value = e.message; } finally { busy.value = false; }
}
async function logout() { try { await api('/logout', { method: 'POST' }); modal.value = null; state.value = null; schoolId.value = ''; query.value = ''; credentials.password = ''; Object.keys(form).forEach(key => delete form[key]); Object.assign(smsForm, { provider: 'smsapi', token: '', enabled: false, testMode: true, sender: '', hasToken: false, recipients: 0 }); savedSms.value = null; smsTestPhone.value = ''; smsTestResult.value = null; } catch (e) { notify(e.message); } }
async function registerSchool() {
  busy.value = true; error.value = '';
  try {
    await api('/register-school', { method: 'POST', body: JSON.stringify(registration) });
    await refresh(); Object.keys(registration).forEach(key => registration[key] = ''); authScreen.value = 'login';
    notify('Szkoła i konto administratora zostały utworzone.');
  } catch (e) { error.value = e.message; } finally { busy.value = false; }
}
function navigate(id) { view.value = id; query.value = ''; mobileMenu.value = false; }
function open(type, record = null, mode = 'edit') {
  Object.keys(form).forEach(k => delete form[k]);
  Object.assign(form, { name: '', city: '', address: '', username: '', email: '', phone: '', password: '', role: 'teacher', subject: '', description: '', category: 'Bezpieczeństwo', severity: 'warning', procedureId: procedures.value[0]?.id || '', stepsText: '', location: '', ...record });
  if (record?.steps) form.stepsText = record.steps.join('\n');
  modal.value = { type, record, mode }; error.value = '';
}
function close() { if (!busy.value) { modal.value = null; error.value = ''; } }
async function generateTeacherLink() {
  busy.value = true; error.value = '';
  try {
    const result = await api(`/teachers/${modal.value.record.id}/panel-key`, { method: 'POST' });
    teacherLink.value = new URL(result.path, window.location.origin).href; teacherKey.value = result.key;
    modal.value.record.hasPanelKey = true; await refresh();
  } catch (e) { error.value = e.message; } finally { busy.value = false; }
}
async function revokeTeacherLink() {
  busy.value = true; error.value = '';
  try {
    await api(`/teachers/${modal.value.record.id}/panel-key`, { method: 'DELETE' });
    modal.value.record.hasPanelKey = false; teacherLink.value = ''; teacherKey.value = ''; accessCopied.value = false;
    await refresh(); notify('Unieważniono link i sesje panelu tego nauczyciela.');
  } catch (e) { error.value = e.message; } finally { busy.value = false; }
}
async function copyTeacherLink() {
  try { await navigator.clipboard.writeText(teacherLink.value); accessCopied.value = true; }
  catch { error.value = 'Nie udało się skopiować automatycznie. Zaznacz link w polu i skopiuj go ręcznie.'; }
}
function openCsvImport() {
  Object.assign(csvImport, { file: null, filename: '', encoding: 'utf-8', text: '', preview: null });
  open('teachers', null, 'import');
}
async function previewCsvFile(event) {
  if (event?.target?.files) csvImport.file = event.target.files[0] || null;
  csvImport.preview = null; csvImport.text = ''; error.value = '';
  const file = csvImport.file;
  if (!file) return;
  csvImport.filename = file.name;
  busy.value = true;
  try {
    if (file.size > 512 * 1024) throw new Error('Plik może mieć maksymalnie 512 KB.');
    let text;
    try { text = new TextDecoder(csvImport.encoding, { fatal: true }).decode(await file.arrayBuffer()); }
    catch { throw new Error('Nie udało się odczytać znaków. Spróbuj wybrać kodowanie Windows-1250.'); }
    csvImport.text = text;
    csvImport.preview = await api('/teachers/import/preview', { method: 'POST', body: JSON.stringify({ csv: text }) });
  } catch (e) { error.value = e.message; } finally { busy.value = false; }
}
async function commitCsvImport() {
  if (!csvImport.preview?.ready || csvImport.preview.invalid) return;
  busy.value = true; error.value = '';
  try {
    const result = await api('/teachers/import', { method: 'POST', body: JSON.stringify({ csv: csvImport.text }) });
    modal.value = null; query.value = ''; await refresh();
    notify(`Import zakończony. Dodano: ${result.imported}, pominięto duplikaty: ${result.skipped}.`);
  } catch (e) { error.value = e.message; if (e.preview) csvImport.preview = e.preview; } finally { busy.value = false; }
}
const modalTitle = computed(() => {
  if (!modal.value) return '';
  if (modal.value.mode === 'bulk-links') return modal.value.record ? 'Wyślij SMS z linkiem' : 'Wyślij linki do wszystkich';
  if (modal.value.mode === 'access') return 'Osobisty panel nauczyciela';
  if (modal.value.mode === 'import') return 'Import nauczycieli z CSV';
  if (modal.value.mode === 'launch') return 'Uruchom alert';
  if (modal.value.mode === 'delete') return 'Usunąć ten rekord?';
  if (modal.value.mode === 'detail') return modal.value.record.name;
  if (modal.value.mode === 'resolve') return 'Zakończ zdarzenie';
  return `${modal.value.record ? 'Edytuj' : 'Dodaj'} ${ { schools: 'szkołę', teachers: 'nauczyciela', alerts: 'alert', procedures: 'procedurę', users: 'użytkownika' }[modal.value.type] }`;
});
async function submit() {
  busy.value = true; error.value = '';
  try {
    const { type, record, mode } = modal.value;
    if (mode === 'launch') await api('/incidents', { method: 'POST', body: JSON.stringify({ alertId: record.id, location: form.location }) });
    else if (mode === 'resolve') await api(`/incidents/${record.id}/resolve`, { method: 'POST' });
    else if (mode === 'delete') await api(`/${type}/${record.id}`, { method: 'DELETE' });
    else {
      const result = await api(`/${type}${record ? '/' + record.id : ''}`, { method: record ? 'PUT' : 'POST', body: JSON.stringify({ ...form, schoolId: schoolId.value, steps: form.stepsText.split('\n').map(x => x.trim()).filter(Boolean) }) });
      if (type === 'schools') {
        schoolId.value = result.id;
        query.value = '';
        if (!state.value.schools.length) navigate('dashboard');
      }
    }
    modal.value = null; await refresh(); notify(mode === 'launch' ? 'Alert uruchomiony w panelu szkoły.' : mode === 'delete' ? 'Rekord usunięty.' : type === 'schools' && !record ? 'Szkoła dodana. Możesz teraz dodać nauczycieli.' : 'Zmiany zostały zapisane.');
  } catch (e) { error.value = e.message; } finally { busy.value = false; }
}
async function initialize() {
  loading.value = true;
  error.value = '';
  try { health.value = await api('/health'); await refresh(); }
  catch (e) {
    if (!health.value?.loginRequired) error.value = 'Nie udało się otworzyć panelu. Sprawdź połączenie z serwerem i spróbuj ponownie.';
  }
  finally { loading.value = false; }
}
onMounted(() => {
  initialize();
  timer = setInterval(() => { if (state.value && !busy.value) refresh().catch(e => notify(e.message)); }, 15000);
});
onUnmounted(() => { clearInterval(timer); clearTimeout(toastTimer); });
</script>

<template>
  <div v-if="loading" class="loading"><LoaderCircle class="spin" :size="32"/><p>Przygotowujemy Twój panel…</p></div>
  <div v-else-if="!state && health?.loginRequired" class="login-page">
    <section class="login-story"><a class="brand" href="/"><span class="brand-icon"><ShieldCheck :size="27"/></span><span>szkolny<span class="brand-light">alert</span><small>WSPÓLNIE DLA BEZPIECZEŃSTWA</small></span></a><div><span class="eyebrow">SPOKÓJ ZACZYNA SIĘ OD PRZYGOTOWANIA</span><h1>Jedna szkoła.<br>Jeden zespół.<br><em>Wspólne bezpieczeństwo.</em></h1><p>Nauczyciele, alerty i procedury — zawsze pod ręką, kiedy liczy się jasny plan działania.</p><div class="login-seal"><ShieldCheck :size="22"/> Zaprojektowane z myślą o szkolnej codzienności</div></div><small>Szkolny Alert · Panel zarządzania szkołą</small></section>
    <section :class="['login-form', { 'school-registration': authScreen === 'register' }]">
      <template v-if="authScreen === 'register'">
        <span class="eyebrow">NOWA PLACÓWKA</span><h2>Dodaj swoją szkołę.</h2><p>Podaj nazwę szkoły i dane do logowania. Utworzymy konto administratora wyłącznie tej placówki.</p>
        <form class="registration-form" @submit.prevent="registerSchool">
          <label>Nazwa szkoły<input v-model="registration.name" required maxlength="200" autocomplete="organization"></label>
          <label>Nazwa użytkownika<input v-model="registration.username" required minlength="3" maxlength="80" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="np. administrator.sp12"></label>
          <label>Hasło<input v-model="registration.password" required type="password" minlength="11" maxlength="128" autocomplete="new-password" placeholder="Minimum 11 znaków"></label>
          <p v-if="error" class="error" role="alert">{{ error }}</p>
          <button class="btn primary full" :disabled="busy">{{ busy ? 'Tworzenie szkoły…' : 'Utwórz szkołę i wejdź do panelu' }}<ArrowRight :size="17"/></button>
        </form>
        <button class="auth-switch" :disabled="busy" @click="authScreen = 'login'; error = ''">Mam już konto — zaloguj się</button>
      </template>
      <template v-else>
        <span class="eyebrow">TWÓJ PANEL SZKOŁY</span><h2>Dobrze Cię widzieć.</h2><p>Zaloguj się do szkoły przypisanej do Twojego konta.</p>
        <form @submit.prevent="login()"><label>Nazwa użytkownika<input v-model="credentials.login" autocomplete="username" required maxlength="200" autocapitalize="none" spellcheck="false" placeholder="Nazwa użytkownika lub e-mail"></label><label>Hasło<input v-model="credentials.password" type="password" autocomplete="current-password" required placeholder="Twoje hasło"></label><p v-if="error" class="error" role="alert">{{ error }}</p><button class="btn primary full" :disabled="busy">{{ busy ? 'Logowanie…' : 'Zaloguj się' }}<ArrowRight :size="18"/></button></form>
        <button class="btn secondary full register-school-button" :disabled="busy" @click="authScreen = 'register'; error = ''"><Plus :size="17"/> Dodaj szkołę</button>
      </template>
    </section>
  </div>
  <div v-else-if="!state" class="loading connection-screen"><ShieldAlert :size="34"/><h2>Panel chwilowo niedostępny</h2><p role="alert">{{ error || 'Nie udało się pobrać danych szkoły.' }}</p><button class="btn primary" @click="initialize">Spróbuj ponownie</button></div>
  <div v-else class="app-shell">
    <button v-if="mobileMenu" class="menu-backdrop" aria-label="Zamknij menu" @click="mobileMenu = false"></button>
    <aside :class="['sidebar', { visible: mobileMenu }]">
      <a href="#" class="brand" @click.prevent="navigate('dashboard')"><span class="brand-icon"><ShieldCheck :size="27"/></span><span>szkolny<span class="brand-light">alert</span><small>WSPÓLNIE DLA BEZPIECZEŃSTWA</small></span></a>
      <div class="workspace-label">PRZESTRZEŃ TWOJEJ SZKOŁY</div>
      <nav><button v-for="item in nav" :key="item.id" :class="{ selected: view === item.id }" @click="navigate(item.id)"><component :is="item.icon" :size="19"/><span>{{ item.label }}</span><span v-if="counts[item.id]" :class="['nav-count', { 'has-alert': item.id === 'alerts' && active.length }]">{{ counts[item.id] }}</span><span v-if="item.id === 'dashboard'" class="selected-dot"></span></button></nav>
      <div class="sidebar-bottom"><div class="help-card"><span class="help-icon"><ShieldCheck :size="23"/></span><h3>Przygotowanie daje spokój.</h3><p>Zadbaj, by każdy wiedział,<br>jak zareagować.</p><button @click="navigate('procedures')">Przejrzyj procedury <ArrowUpRight :size="16"/></button></div><div class="profile"><span class="avatar admin">{{ initials(state.user.name) }}</span><span><strong>{{ state.user.name }}</strong><small>{{ canManage ? 'Administrator szkoły' : 'Nauczyciel' }}</small></span><button v-if="state.loginRequired" class="icon-button" title="Wyloguj" aria-label="Wyloguj" @click="logout"><LogOut :size="17"/></button></div></div>
    </aside>
    <div class="main-shell">
      <header class="topbar"><div class="school-switch"><button class="icon-button mobile-toggle" aria-label="Otwórz menu" @click="mobileMenu = true"><Menu :size="22"/></button><Building2 :size="20" class="muted"/><span class="current-school-name">{{ school?.name }}</span></div><div class="topbar-right"><span v-if="state.demo" class="demo-label">DANE DEMONSTRACYJNE</span><span class="topbar-date">{{ today }}</span><span class="avatar small">{{ initials(state.user.name) }}</span></div></header>
      <main>
        <div v-if="active.length" :class="['active-banner', priorityIncident.severity]" role="status"><Radio :size="21"/><div><strong>{{ active.length }} {{ active.length === 1 ? 'aktywny alert' : 'aktywne alerty' }}</strong><span>{{ priorityIncident.name }} · {{ priorityIncident.location }}</span></div><button @click="navigate('history')">Zobacz zdarzenia <ArrowRight :size="17"/></button></div>
        <div class="page-heading"><div><div class="breadcrumb">Twoja szkoła <ChevronRight :size="13"/> {{ nav.find(n => n.id === view)?.label }}</div><h1>{{ view === 'dashboard' ? (active.length ? 'Bezpieczeństwo na pierwszym miejscu.' : 'Wszystko pod kontrolą.') : nav.find(n => n.id === view)?.label }}<span v-if="view === 'dashboard'" class="heading-dot"></span></h1><p>{{ view === 'dashboard' && active.length ? 'Zobacz bieżące zdarzenia i przejdź do instrukcji działania.' : titles[view] }}</p></div><button v-if="view === 'dashboard'" class="btn primary alert-cta" :disabled="!school" @click="navigate('alerts')"><Radio :size="17"/> Uruchom alert</button><button v-else-if="canManage && !['history', 'schools', 'settings'].includes(view)" class="btn primary" :disabled="view !== 'schools' && !school" @click="open(view)"><Plus :size="18"/>{{ { schools: 'Dodaj szkołę', teachers: 'Dodaj nauczyciela', procedures: 'Dodaj procedurę', alerts: 'Dodaj alert', users: 'Dodaj użytkownika' }[view] }}</button></div>


        <template v-if="view === 'dashboard'">
          <section v-if="priorityIncident" :class="['emergency-hero', priorityIncident.severity]">
            <div class="emergency-content">
              <div class="emergency-label"><span class="signal-dot"></span>{{ priorityIncident.severity === 'critical' ? 'POWAŻNY ALERT' : 'AKTYWNE ZDARZENIE' }}<span v-if="priorityIncident.isDemo" class="exercise-badge">ĆWICZENIE · DANE DEMO</span></div>
              <h2>{{ priorityIncident.name }}</h2>
              <p class="emergency-location"><MapPin :size="17"/>{{ priorityIncident.location }}</p>
              <p class="emergency-description">{{ priorityIncident.isDemo ? 'Przykładowy scenariusz. Poznaj widok alarmowy i sprawdź procedurę przypisaną do zdarzenia.' : 'Zapoznaj się z procedurą i postępuj zgodnie z instrukcjami koordynatora szkoły.' }}</p>
              <div class="emergency-buttons"><button class="btn emergency-action" @click="open('procedures', priorityIncident.procedure, 'detail')"><BookOpen :size="17"/> Otwórz procedurę <ArrowRight :size="16"/></button><button class="emergency-link" @click="navigate('history')">Szczegóły zdarzenia <ArrowUpRight :size="16"/></button></div>
              <div class="emergency-meta"><Clock3 :size="13"/> Zgłoszono {{ date(priorityIncident.createdAt) }} <span>·</span> {{ school?.name }}</div>
            </div>
            <div class="emergency-visual" aria-hidden="true"><div class="emergency-ring ring-outer"></div><div class="emergency-ring ring-inner"></div><div class="emergency-symbol"><ShieldAlert :size="90" :stroke-width="1.25"/></div><span class="emergency-visual-label">{{ priorityIncident.isDemo ? 'TRYB ĆWICZENIOWY' : 'WYMAGANA REAKCJA' }}</span></div>
          </section>
          <section v-else class="welcome-panel"><div><span class="eyebrow"><span class="live-dot"></span> {{ active.length ? 'WYMAGANA REAKCJA' : 'CODZIENNIE GOTOWI DO DZIAŁANIA' }}</span><h2>Bezpieczna szkoła<br>to nasza wspólna sprawa.</h2><p>Twój zespół i zasady działania w jednym miejscu.<br>Sprawdź przygotowanie i zadbaj o spokojny dzień.</p><button @click="navigate('procedures')">Poznaj procedury szkoły <ArrowRight :size="17"/></button></div><div class="school-art" aria-hidden="true"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="art-shield"><ShieldCheck :size="100" :stroke-width="1.1"/></div><div class="art-chip chip-one"><CheckCircle2 :size="15"/> Jasny plan działania</div><div class="art-chip chip-two"><Users :size="15"/> Jeden zespół</div><span class="spark spark-one">+</span><span class="spark spark-two">+</span></div></section>
          <section class="stats-grid"><button class="stat-card" @click="navigate('teachers')"><div><span class="stat-icon sage"><Users :size="20"/></span><ArrowUpRight :size="17" class="muted"/></div><strong>{{ teachers.length }}<span>Nauczyciele</span></strong><p>Twój zespół w szkole</p></button><button class="stat-card" @click="navigate('alerts')"><div><span class="stat-icon peach"><Bell :size="20"/></span><ArrowUpRight :size="17" class="muted"/></div><strong>{{ alerts.length }}<span>Zdefiniowane alerty</span></strong><p>Gotowe scenariusze reakcji</p></button><button class="stat-card" @click="navigate('procedures')"><div><span class="stat-icon lavender"><BookOpen :size="20"/></span><ArrowUpRight :size="17" class="muted"/></div><strong>{{ procedures.length }}<span>Procedury</span></strong><p>Instrukcje krok po kroku</p></button><button :class="['stat-card', { 'stat-critical': hasCritical }]" @click="navigate('history')"><div><span class="stat-icon blue"><Activity :size="20"/></span><ArrowUpRight :size="17" class="muted"/></div><strong>{{ active.length }}<span>Aktywne zdarzenia</span></strong><p><span :class="['status-dot', { orange: active.length }]"></span>{{ active.length ? 'Sprawdź bieżące zdarzenia' : 'Brak aktywnych alertów' }}</p></button></section>
          <div class="dashboard-columns"><section class="panel"><div class="section-heading"><div><h2>Alerty i szybka reakcja</h2><p>Wybierz scenariusz, gdy pojawi się zagrożenie.</p></div><button class="text-link" @click="navigate('alerts')">Wszystkie <ArrowRight :size="15"/></button></div><div v-if="!alerts.length" class="empty compact"><Bell :size="25"/><p>Dodaj pierwszy alert dla tej szkoły.</p><button v-if="canManage" class="text-link" :disabled="!school" @click="open('alerts')">Dodaj alert <Plus :size="15"/></button></div><div v-for="a in alerts.slice(0, 3)" :key="a.id" :class="['alert-row', { 'row-critical': a.severity === 'critical' }]"><span :class="['alert-icon', a.severity]"><component :is="alertIcon(a)" :size="22"/></span><div><strong>{{ a.name }}<span v-if="a.severity === 'critical'" class="row-severity">POWAŻNY</span></strong><span>{{ procedures.find(p => p.id === a.procedureId)?.name }}</span></div><button class="icon-button row-arrow" :aria-label="'Uruchom: ' + a.name" @click="open('alerts', a, 'launch')"><ArrowUpRight :size="19"/></button></div><div class="panel-note"><CircleHelp :size="15"/> Alerty są widoczne w panelu. Powiadomienia push nie są jeszcze podłączone.</div></section>
          <section class="panel procedures-panel"><div class="section-heading"><div><h2>Warto mieć pod ręką</h2><p>Wiedza, która pomaga działać.</p></div><BookOpen :size="20" class="muted"/></div><div v-for="(p, i) in procedures.slice(0, 2)" :key="p.id" class="procedure-preview" @click="open('procedures', p, 'detail')"><span class="procedure-number">0{{ i + 1 }}</span><div><span class="eyebrow">{{ p.category }}</span><h3><button class="plain-button" @click.stop="open('procedures', p, 'detail')">{{ p.name }}</button></h3><p>{{ p.steps.length }} kroki postępowania</p></div><ChevronRight :size="18" class="muted"/></div><p v-if="!procedures.length" class="empty">Brak procedur. Dodaj pierwszą instrukcję.</p><button class="all-procedures" @click="navigate('procedures')">Biblioteka procedur <ArrowRight :size="16"/></button></section></div>
          <section class="team-strip"><span class="stat-icon sage"><Users :size="22"/></span><div><h3>Bezpieczeństwo zaczyna się od zespołu.</h3><p>Dodaj nauczycieli i uporządkuj dane kontaktowe swojej szkoły.</p></div><div class="avatar-stack"><span v-for="t in teachers.slice(0, 3)" :key="t.id" class="avatar">{{ initials(t.name) }}</span></div><button v-if="canManage" class="btn secondary" :disabled="!school" @click="open('teachers')"><Plus :size="16"/> Dodaj nauczyciela</button></section>
          <section class="panel recent-events"><div class="section-heading"><div><span class="eyebrow">DZIENNIK SZKOŁY</span><h2>Ostatnie zdarzenia</h2></div><button class="text-link" @click="navigate('history')">Cała historia <ArrowRight :size="15"/></button></div><button v-for="event in incidents.slice(0, 3)" :key="event.id" class="recent-event" @click="navigate('history')"><span :class="['timeline-icon', event.status === 'active' ? event.severity : 'success']"><component :is="event.status === 'active' ? Radio : CheckCircle2" :size="17"/></span><span class="recent-event-title"><strong>{{ event.name }}</strong><small>{{ event.location }}</small></span><span class="recent-event-date">{{ date(event.createdAt) }}</span><span :class="['badge', event.status === 'active' ? event.severity : 'success']">{{ event.status === 'active' ? 'W toku' : 'Zakończone' }}</span><ChevronRight :size="16" class="muted"/></button><p v-if="!incidents.length" class="empty compact">Tutaj pojawią się zgłoszone zdarzenia.</p></section>
        </template>

        <section v-else-if="view === 'settings' && canManage" class="sms-settings-grid">
          <div class="panel sms-settings-panel"><div class="section-heading"><div><span class="eyebrow">POWIADOMIENIA SMS</span><h2>Bramka SMS</h2></div><MessageSquare :size="23" class="muted"/></div>
            <form class="sms-settings-form" @submit.prevent="saveSmsSettings">
              <div class="sms-token-status"><span :class="['badge', smsForm.hasToken ? 'success' : 'neutral']">{{ smsForm.hasToken ? 'Token zapisany' : 'Brak tokenu' }}</span><span>{{ school?.name }}</span></div>
              <label>Operator SMS<select v-model="smsForm.provider" :disabled="smsBusy"><option value="smsapi">SMSAPI</option><option value="hostava">Hostava</option></select></label>
              <label>{{ smsForm.provider === 'hostava' ? 'Klucz API Hostava' : 'Token OAuth SMSAPI' }}<input v-model="smsForm.token" type="password" autocomplete="new-password" maxlength="4096" :disabled="smsBusy" :placeholder="smsForm.hasToken && smsForm.provider === savedSms?.provider ? 'Zapisany — pozostaw puste, aby zachować' : 'Wklej klucz operatora'"></label>
              <p class="form-hint">Klucz jest szyfrowany na serwerze i nie jest odsyłany do przeglądarki. Zmiana operatora wymaga jego własnego klucza.</p>
              <p v-if="smsForm.provider === 'hostava'" class="form-hint">Możesz pozostawić pole puste, jeśli administrator serwera skonfigurował klucz Hostava. Zostanie przypisany do szkoły przy zapisie ustawień.</p>
              <template v-if="smsForm.provider === 'smsapi'"><label>Nazwa nadawcy (opcjonalnie)<input v-model="smsForm.sender" maxlength="11" :disabled="smsBusy" placeholder="np. Szkola"></label><p class="form-hint">Użyj nazwy zatwierdzonej na swoim koncie SMSAPI. Puste pole oznacza domyślnego nadawcę konta.</p></template>
              <label class="sms-checkbox"><input v-model="smsForm.testMode" type="checkbox" :disabled="smsBusy"><span><strong>Tryb testowy</strong><small>{{ smsForm.provider === 'hostava' ? 'Symulacja lokalna: bez wywołania API. Nie sprawdza klucza ani salda.' : 'Wywołuje API z test=1. SMS-y nie są dostarczane.' }}</small></span></label>
              <label class="sms-checkbox"><input v-model="smsForm.enabled" type="checkbox" :disabled="smsBusy"><span><strong>Automatyczne SMS-y przy uruchomieniu alertu</strong><small>Odbiorcy: nauczyciele z katalogu tej szkoły. Poprawne, unikalne numery: {{ smsForm.recipients }}.</small></span></label>
              <p v-if="!smsForm.testMode" class="sms-live-notice">Tryb rzeczywisty: wysyłka jest płatna według Twojego konta operatora. Dłuższy komunikat może zostać rozliczony jako kilka części.</p>
              <p v-if="smsError" class="error" role="alert">{{ smsError }}</p>
              <div class="sms-settings-actions"><button class="btn primary" :disabled="smsBusy">{{ smsBusy ? 'Zapisywanie…' : 'Zapisz ustawienia' }}<Check :size="16"/></button><button v-if="smsForm.hasToken" type="button" class="text-link" :disabled="smsBusy" @click="removeSmsToken">Usuń token i wyłącz SMS-y</button></div>
            </form>
          </div>
          <div class="panel sms-settings-panel"><div class="section-heading"><div><span class="eyebrow">SPRAWDŹ KONFIGURACJĘ</span><h2>Test bramki</h2></div><Radio :size="21" class="muted"/></div>
            <form class="sms-settings-form" @submit.prevent="testSms"><label>Numer testowy<input v-model="smsTestPhone" type="tel" required maxlength="32" autocomplete="tel" :disabled="smsBusy" placeholder="+48 500 600 700"></label><p class="form-hint">Test używa ostatnio zapisanych ustawień. Tryb testowy Hostava wykonuje lokalną symulację; SMSAPI sprawdza odpowiedź API bez dostarczenia wiadomości. W trybie rzeczywistym zostanie wysłany płatny SMS na wskazany numer.</p><p v-if="smsDirty" class="form-hint">Zapisz ustawienia przed wykonaniem testu.</p><button class="btn secondary full" :disabled="smsBusy || !smsForm.hasToken || smsDirty || !smsTestPhone"><MessageSquare :size="17"/>{{ smsForm.testMode ? (smsForm.provider === 'hostava' ? 'Uruchom symulację' : 'Sprawdź API bez wysyłki') : 'Wyślij płatny SMS testowy' }}</button><div v-if="smsTestResult" :class="['sms-test-result', smsTestResult.status]"><strong>{{ smsTestResult.status === 'test' ? 'Tryb testowy zakończony' : smsTestResult.status === 'accepted' ? 'Przyjęto do wysyłki' : 'Sprawdź wynik testu' }}</strong><p>{{ smsTestResult.message }}</p></div></form>
            <div class="sms-settings-help"><h3>Numery i wyniki</h3><p>Numery krajowe z 9 cyframi otrzymują prefiks 48. Numery zagraniczne wpisuj z prefiksem kraju. Powtarzające się numery są pomijane.</p><p>Przyjęcie przez operatora nie oznacza doręczenia. Wynik wysyłki zobaczysz w Historii zdarzeń; raporty doręczenia sprawdzisz w panelu operatora.</p><a v-if="smsForm.provider === 'smsapi'" href="https://www.smsapi.pl/docs" target="_blank" rel="noopener noreferrer" class="text-link">Dokumentacja SMSAPI <ArrowUpRight :size="15"/></a></div>
          </div>
        </section>
        <template v-else>
          <div class="list-toolbar"><div class="search-field"><Search :size="18"/><input v-model="query" :placeholder="view === 'teachers' ? 'Szukaj nauczyciela…' : 'Szukaj…'" aria-label="Szukaj rekordów"></div><div class="list-toolbar-actions"><span>{{ list.length }} {{ view === 'history' ? 'zdarzeń' : 'rekordów' }}</span><button v-if="view === 'teachers' && canManage" class="btn primary" @click="openLinkSms()"><MessageSquare :size="16"/> Wyślij linki do wszystkich</button><button v-if="view === 'teachers' && canManage" class="btn secondary" @click="openCsvImport"><Upload :size="16"/> Import CSV</button></div></div>
          <div v-if="!list.length" class="panel empty"><component :is="nav.find(n => n.id === view)?.icon" :size="36"/><h2>{{ query ? 'Brak wyników' : 'Tu zaczyna się dobra organizacja.' }}</h2><p>{{ query ? 'Spróbuj wpisać inne słowo.' : canManage ? 'Dodaj pierwszy rekord, korzystając z przycisku powyżej.' : 'Administrator szkoły nie dodał jeszcze wpisów.' }}</p></div>
          <div v-else-if="view === 'teachers'" class="panel table-wrap"><table><thead><tr><th>Nauczyciel</th><th>Przedmiot / rola</th><th>Kontakt</th><th>Telefon</th><th><span class="sr-only">Działania</span></th></tr></thead><tbody><tr v-for="t in list" :key="t.id"><td><div class="person-cell"><span class="avatar">{{ initials(t.name) }}</span><strong>{{ t.name }}</strong></div></td><td>{{ t.subject }}</td><td><a :href="'mailto:' + t.email">{{ t.email }}</a></td><td><a v-if="t.phone" :href="'tel:' + t.phone.replace(/[^0-9+]/g, '')">{{ t.phone }}</a><span v-else class="muted">—</span></td><td><div v-if="canManage" class="actions"><button class="icon-button teacher-link-sms" :aria-label="'Wyślij SMS z linkiem: ' + t.name" title="Wyślij SMS z linkiem do aplikacji" @click="openLinkSms(t)"><MessageSquare :size="17"/></button><button class="icon-button teacher-panel-link" :aria-label="'Panel nauczyciela: ' + t.name" :title="t.hasPanelKey ? 'Zarządzaj osobistym linkiem' : 'Utwórz osobisty link'" @click="open('teachers', t, 'access')"><Link :size="17"/></button><button class="icon-button" :aria-label="'Edytuj: ' + t.name" @click="open('teachers', t)"><Pencil :size="16"/></button><button class="icon-button" :aria-label="'Usuń: ' + t.name" @click="open('teachers', t, 'delete')"><Trash2 :size="16"/></button></div></td></tr></tbody></table></div>
          <div v-else-if="view === 'users'" class="panel table-wrap"><table><thead><tr><th>Użytkownik</th><th>Login</th><th>Telefon</th><th>Rola</th><th>Działania</th></tr></thead><tbody><tr v-for="u in list" :key="u.id"><td><div class="person-cell"><span class="avatar">{{ initials(u.name) }}</span><strong>{{ u.name }}</strong></div></td><td>{{ u.username }}</td><td><a v-if="u.phone" :href="'tel:' + u.phone.replace(/[^0-9+]/g, '')">{{ u.phone }}</a><span v-else class="muted">—</span></td><td><span class="badge neutral">{{ u.role === 'admin' ? 'Administrator' : 'Nauczyciel' }}</span></td><td><div class="actions"><button class="icon-button" :aria-label="'Edytuj: ' + u.name" @click="open('users', u)"><Pencil :size="16"/></button><button class="icon-button" :aria-label="'Usuń: ' + u.name" @click="open('users', u, 'delete')"><Trash2 :size="16"/></button></div></td></tr></tbody></table></div>
          <div v-else-if="view === 'history'" class="history-list"><article v-for="event in list" :key="event.id" :class="['panel event-card', { 'event-critical': event.status === 'active' && event.severity === 'critical' } ]"><span :class="['alert-icon', event.status === 'active' ? event.severity : 'info']"><component :is="event.status === 'active' ? Radio : CheckCircle2" :size="24"/></span><div class="event-main"><span :class="['badge', event.status === 'active' ? event.severity : 'success']">{{ event.status === 'active' ? 'Aktywne' : 'Zakończone' }}</span><h2>{{ event.name }}</h2><span v-if="event.isDemo" class="event-demo-label">SCENARIUSZ DEMONSTRACYJNY</span><p><MapPin :size="14"/> {{ event.location }} <span>· {{ date(event.createdAt) }}</span></p><div v-if="event.sms" :class="['sms-event-status', event.sms.status]"><strong>{{ smsStatus(event) }}</strong><p v-if="event.sms.message">{{ event.sms.message }}</p></div><small v-if="event.resolvedAt">Zakończono: {{ date(event.resolvedAt) }}</small><details v-if="event.procedure"><summary>Procedura postępowania</summary><ol><li v-for="step in event.procedure.steps" :key="step">{{ step }}</li></ol></details></div><button v-if="canManage && event.status === 'active'" class="btn secondary" @click="open('incidents', event, 'resolve')"><Check :size="16"/> Zakończ</button></article></div>
          <div v-else class="record-grid"><article v-for="item in list" :key="item.id" :class="['panel record-card', { 'record-critical': view === 'alerts' && item.severity === 'critical' }]"><div class="record-top"><span :class="['stat-icon', view === 'alerts' ? item.severity : 'sage']"><component :is="view === 'schools' ? Building2 : view === 'procedures' ? BookOpen : alertIcon(item)" :size="23"/></span><span v-if="view === 'alerts'" :class="['badge', item.severity]">{{ level(item.severity) }}</span><span v-if="view === 'procedures'" class="badge neutral">{{ item.category }}</span></div><h2>{{ item.name }}</h2><p>{{ view === 'schools' ? [item.address, item.city].filter(Boolean).join(', ') || 'Dane adresowe możesz uzupełnić później.' : item.description }}</p><div v-if="view === 'alerts'" class="linked-procedure"><BookOpen :size="15"/>{{ procedures.find(p => p.id === item.procedureId)?.name }}</div><div v-if="view === 'procedures'" class="linked-procedure"><CheckCircle2 :size="15"/>{{ item.steps.length }} kroki postępowania</div><div class="record-actions"><button v-if="view === 'alerts'" class="text-link" @click="open('alerts', item, 'launch')">Uruchom alert <ArrowUpRight :size="16"/></button><button v-else-if="view === 'procedures'" class="text-link" @click="open('procedures', item, 'detail')">Otwórz procedurę <ArrowRight :size="16"/></button><button v-else class="text-link" @click="navigate('dashboard')">Pulpit szkoły <ArrowRight :size="16"/></button><div v-if="canManage" class="actions"><button class="icon-button" :aria-label="'Edytuj: ' + item.name" @click="open(view, item)"><Pencil :size="16"/></button><button v-if="view !== 'schools'" class="icon-button" :aria-label="'Usuń: ' + item.name" @click="open(view, item, 'delete')"><Trash2 :size="16"/></button></div></div></article></div>
        </template>
        <footer><span><ShieldCheck :size="14"/> Szkolny Alert <span class="footer-dot">·</span> Wspólnie dla bezpieczeństwa</span><span>Panel szkoły <span class="footer-dot">·</span> Wersja 0.1</span></footer>
      </main>
    </div>
    <div v-if="modal" class="modal-backdrop" @click.self="close" @keydown.esc="close"><section ref="dialog" :class="['modal', { 'csv-modal': modal.mode === 'import' }]" @keydown="dialogKeys" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header><div><span class="eyebrow">SZKOLNY ALERT</span><h2 id="modal-title">{{ modalTitle }}</h2></div><button class="icon-button" aria-label="Zamknij" :disabled="busy" @click="close"><X :size="22"/></button></header>
      <template v-if="modal.mode === 'bulk-links'">
        <div class="teacher-access-admin">
          <p v-if="modal.record" class="modal-description">SMS z osobistym linkiem do aplikacji otrzyma <strong>{{ modal.record.name }}</strong> na numer <strong>{{ modal.record.phone || 'brak numeru telefonu' }}</strong>.</p>
          <p v-else class="modal-description">Osobiste linki do panelu otrzymają nauczyciele szkoły <strong>{{ school?.name }}</strong>. Wysyłka obejmuje całą szkołę, niezależnie od wyszukiwania.</p>
          <p v-if="busy" role="status"><LoaderCircle class="spin" :size="17"/> {{ linkSmsAttempted ? 'Wysyłanie wiadomości…' : 'Sprawdzanie odbiorców…' }}</p>
          <template v-if="linkSmsPreview">
            <div class="csv-summary"><span><strong>{{ linkSmsPreview.count }}</strong> odbiorców SMS</span><span><strong>{{ linkSmsPreview.skipped.length }}</strong> pominiętych</span></div>
            <p class="modal-description"><strong>{{ linkSmsPreview.testMode ? 'TRYB TESTOWY — SMS-y nie zostaną dostarczone.' : 'Potwierdzasz płatną wysyłkę SMS z osobistym linkiem do ' + linkSmsPreview.count + ' osób?' }}</strong></p>
            <p v-if="linkSmsPreview.testMode && state.smsGateway?.provider === 'hostava'" class="form-hint">Hostava wykona lokalną symulację bez sprawdzania klucza API i salda.</p><p class="form-hint">Każda osoba otrzyma własny link. Dotychczasowe linki nadal działają; można je unieważnić w panelu danego nauczyciela. Operator może rozliczyć dłuższą wiadomość jako kilka SMS-ów.</p>
            <p class="form-hint">Adres aplikacji: {{ linkSmsPreview.baseUrl || 'nieskonfigurowany' }}</p>
            <p v-for="issue in linkSmsPreview.issues" :key="issue" class="error">{{ issue }}</p>
            <details v-if="linkSmsPreview.recipients.length"><summary>Odbiorcy ({{ linkSmsPreview.count }})</summary><p v-for="person in linkSmsPreview.recipients" :key="person.id" class="form-hint">{{ person.name }} · +{{ person.phone }}</p></details>
            <details v-if="linkSmsPreview.skipped.length"><summary>Pominięte osoby ({{ linkSmsPreview.skipped.length }})</summary><p v-for="person in linkSmsPreview.skipped" :key="person.id" class="form-hint">{{ person.name }} — {{ person.reason }}</p></details>
          </template>
          <div v-if="linkSmsResult" role="status"><p>{{ linkSmsResult.message }}</p><p v-if="linkSmsResult.total">Przyjęto przez {{ state.smsGateway?.provider === 'hostava' ? 'Hostava' : 'SMSAPI' }}: <strong>{{ linkSmsResult.accepted }} / {{ linkSmsResult.total }}</strong>. Błędy: {{ linkSmsResult.failed }}. Nieznany wynik: {{ linkSmsResult.unknown }}.</p></div>
          <p v-if="error" class="error" role="alert">{{ error }}</p>
          <div class="modal-footer"><button class="btn secondary" :disabled="busy" @click="close">{{ linkSmsAttempted ? 'Zamknij' : 'Anuluj' }}</button><button v-if="!linkSmsAttempted" class="btn primary" :disabled="busy || !linkSmsPreview?.canSend" @click="sendTeacherLinks"><MessageSquare :size="16"/> {{ linkSmsPreview?.testMode ? 'Potwierdzam tryb testowy' : 'Potwierdzam wysyłkę SMS' }} ({{ linkSmsPreview?.count || 0 }})</button></div>
        </div>
      </template>
      <template v-else-if="modal.mode === 'import'">
        <div class="csv-import-body">
          <p class="modal-description">Wybierz plik CSV z nauczycielami. Import dotyczy wyłącznie szkoły <strong>{{ school?.name }}</strong>. Sprawdź podgląd przed zapisem.</p>
          <div class="csv-file-tools"><label>Plik CSV<input type="file" accept=".csv,text/csv" :disabled="busy" @change="previewCsvFile"></label><label>Kodowanie<select v-model="csvImport.encoding" :disabled="busy" @change="previewCsvFile"><option value="utf-8">UTF-8</option><option value="windows-1250">Windows-1250</option></select></label><a class="text-link" href="/api/teachers/import/template" download="nauczyciele-wzor.csv"><Download :size="16"/> Pobierz wzór CSV</a></div>
          <p class="form-hint">Kolumny: imię i nazwisko, email, przedmiot, telefon (opcjonalny). Obsługiwane separatory: średnik, przecinek i tabulator. Maksymalnie 500 nauczycieli i 512 KB. Istniejące adresy e-mail będą pomijane. Każdy nowy nauczyciel automatycznie otrzyma osobisty link i klucz do panelu. Import nie tworzy kont administratora ani nie wysyła SMS-ów.</p>
          <p v-if="busy" class="csv-progress" role="status"><LoaderCircle class="spin" :size="17"/> Przetwarzanie pliku…</p>
          <p v-if="error" class="error" role="alert">{{ error }}</p>
          <template v-if="csvImport.preview">
            <div class="csv-summary"><span><strong>{{ csvImport.preview.ready }}</strong> do dodania</span><span><strong>{{ csvImport.preview.skipped }}</strong> duplikatów</span><span :class="{ 'csv-invalid': csvImport.preview.invalid }"><strong>{{ csvImport.preview.invalid }}</strong> błędnych wierszy</span></div>
            <p v-if="csvImport.preview.invalid" class="form-hint">Żadne dane nie zostaną zapisane, dopóki nie poprawisz błędnych wierszy i nie wybierzesz ponownie pliku.</p>
            <div class="csv-preview table-wrap"><table><thead><tr><th>Wiersz</th><th>Imię i nazwisko</th><th>E-mail</th><th>Przedmiot / rola</th><th>Telefon</th><th>Wynik walidacji</th></tr></thead><tbody><tr v-for="row in csvImport.preview.rows" :key="row.line" :class="{ 'csv-error-row': row.status === 'error' }"><td>{{ row.line }}</td><td>{{ row.teacher.name }}</td><td>{{ row.teacher.email }}</td><td>{{ row.teacher.subject }}</td><td>{{ row.teacher.phone || '—' }}</td><td><span :class="['badge', row.status === 'ready' ? 'success' : row.status === 'error' ? 'critical' : 'warning']">{{ row.status === 'ready' ? 'Gotowy' : row.status === 'error' ? 'Błąd' : 'Pominięty' }}</span><small v-if="row.message" class="csv-row-message">{{ row.message }}</small></td></tr></tbody></table></div>
          </template>
          <div class="modal-footer"><button type="button" class="btn secondary" :disabled="busy" @click="close">Anuluj</button><button type="button" class="btn primary" :disabled="busy || !csvImport.preview?.ready || csvImport.preview.invalid > 0" @click="commitCsvImport"><Upload :size="16"/> Importuj nauczycieli ({{ csvImport.preview?.ready || 0 }})</button></div>
        </div>
      </template>
      <template v-else-if="modal.mode === 'access'">
        <div class="teacher-access-admin"><p class="modal-description"><strong>{{ modal.record.name }}</strong><br>{{ school?.name }}</p><p class="form-hint">Nauczyciel otworzy ten link bez hasła do panelu administratora. Zobaczy przycisk uruchomienia alertu oraz aktywne procedury wyłącznie swojej szkoły.</p>
          <template v-if="teacherLink"><label>Osobisty link<textarea :value="teacherLink" readonly rows="3" class="teacher-link-value" @focus="$event.target.select()"></textarea></label><label>Klucz dostępu<input :value="teacherKey" readonly class="teacher-link-value" @focus="$event.target.select()"></label><button class="btn primary full" @click="copyTeacherLink"><Copy :size="16"/>{{ accessCopied ? 'Link skopiowany' : 'Kopiuj link dla nauczyciela' }}</button><p class="form-hint teacher-access-note">Link jest tworzony automatycznie przy dodaniu nauczyciela lub imporcie CSV. Możesz wrócić tutaj i skopiować go ponownie.</p></template>
          <template v-else><p v-if="modal.record.hasPanelKey" class="teacher-access-rotation">Ten nauczyciel ma już link. Wygenerowanie nowego klucza unieważni poprzedni link oraz sesje na jego urządzeniach.</p><button class="btn primary full" :disabled="busy" @click="generateTeacherLink"><KeyRound :size="16"/>{{ busy ? 'Generowanie…' : modal.record.hasPanelKey ? 'Wygeneruj nowy link i klucz' : 'Wygeneruj link i klucz' }}</button></template>
          <p v-if="teacherLink" class="form-hint">Nowy klucz unieważni dotychczasowe linki i sesje tego nauczyciela.</p><button v-if="teacherLink" class="btn secondary full" :disabled="busy" @click="generateTeacherLink">Wygeneruj nowy link i klucz</button><p class="form-hint teacher-access-note">Link działa pod adresem serwera, z którego korzystasz. Aby udostępnić go na telefonach poza tym komputerem, aplikacja musi działać pod dostępnym adresem HTTPS.</p><p v-if="error" class="error" role="alert">{{ error }}</p><div class="modal-footer"><button v-if="modal.record.hasPanelKey" class="text-link" :disabled="busy" @click="revokeTeacherLink">Unieważnij link</button><button class="btn secondary" :disabled="busy" @click="close">Zamknij</button></div>
        </div>
      </template>
      <template v-else-if="modal.mode === 'detail'"><p class="modal-description">{{ modal.record.description }}</p><ol class="steps"><li v-for="(step, i) in modal.record.steps" :key="i"><span>{{ i + 1 }}</span><p>{{ step }}</p></li></ol><div class="modal-footer"><button class="btn secondary" @click="close">Zamknij</button></div></template>
      <form v-else @submit.prevent="submit">
        <template v-if="modal.mode === 'delete'"><p class="modal-description">Rekord „{{ modal.record.name }}” zostanie usunięty. Tej operacji nie można cofnąć.</p></template>
        <template v-else-if="modal.mode === 'resolve'"><p class="modal-description">Potwierdź zakończenie zdarzenia „{{ modal.record.name }}”. Zdarzenie pozostanie w historii szkoły.</p></template>
        <template v-else-if="modal.mode === 'launch'"><div :class="['launch-summary', modal.record.severity]"><ShieldAlert :size="27"/><div><strong>{{ modal.record.name }}</strong><p>{{ modal.record.description }}</p></div></div><p class="form-hint">Alert zostanie zapisany i wyświetlony w panelu szkoły. {{ state.smsGateway?.enabled ? (state.smsGateway.testMode ? 'Bramka SMS działa w trybie testowym bez dostarczenia wiadomości.' : 'Uruchomienie wyśle płatne SMS-y do nauczycieli tej szkoły z poprawnymi numerami telefonu.') : 'Automatyczne SMS-y są wyłączone. Administrator może włączyć je w Ustawieniach.' }}</p><label>Miejsce zdarzenia (opcjonalnie)<input v-model="form.location" maxlength="200" placeholder="np. Budynek A, pierwsze piętro" autofocus></label></template>
        <template v-else><label>{{ ['teachers', 'users'].includes(modal.type) ? 'Imię i nazwisko' : 'Nazwa' }}<input v-model="form.name" required maxlength="200" autofocus :placeholder="modal.type === 'schools' ? 'np. Szkoła Podstawowa nr 12' : ''"></label><template v-if="modal.type === 'schools'"><label>Miejscowość (opcjonalnie)<input v-model="form.city" maxlength="200"></label><label>Adres (opcjonalnie)<input v-model="form.address" maxlength="200"></label></template><template v-else-if="modal.type === 'users'"><label>Nazwa użytkownika<input v-model="form.username" required minlength="3" maxlength="80" autocomplete="off" autocapitalize="none" spellcheck="false"></label><label>E-mail (opcjonalnie)<input v-model="form.email" type="email" maxlength="200" autocomplete="off"></label><label>Telefon (opcjonalnie)<input v-model="form.phone" type="tel" maxlength="32" autocomplete="tel" placeholder="+48 500 600 700"></label><label>Rola<select v-model="form.role"><option value="teacher">Nauczyciel</option><option value="admin">Administrator szkoły</option></select></label><label>{{ modal.record ? 'Nowe hasło (opcjonalnie)' : 'Hasło' }}<input v-model="form.password" type="password" :required="!modal.record" minlength="11" maxlength="128" autocomplete="new-password" placeholder="Minimum 11 znaków"></label><p class="form-hint">Konto otrzyma dostęp wyłącznie do tej szkoły. Zmiana hasła lub roli wyloguje użytkownika z aktywnych sesji.</p></template><template v-else-if="modal.type === 'teachers'"><label>Adres e-mail<input v-model="form.email" type="email" required maxlength="200"></label><label>Telefon (opcjonalnie)<input v-model="form.phone" type="tel" maxlength="32" autocomplete="tel" placeholder="+48 500 600 700"></label><label>Przedmiot / rola<input v-model="form.subject" required maxlength="200" placeholder="np. Matematyka, wychowawca"></label><p class="form-hint">Osobisty link i klucz do panelu zostaną utworzone automatycznie. Po zapisaniu skopiujesz link ikoną przy nauczycielu. Konto z hasłem dodasz w zakładce Użytkownicy.</p></template><template v-else><label>Opis<textarea v-model="form.description" required maxlength="2000" rows="3"></textarea></label><template v-if="modal.type === 'procedures'"><label>Kategoria<input v-model="form.category" required maxlength="200"></label><label>Kroki postępowania<textarea v-model="form.stepsText" required rows="6" placeholder="Każdy krok wpisz w osobnej linii"></textarea></label><p class="form-hint">Procedury powinny być zatwierdzone przez osoby odpowiedzialne za bezpieczeństwo w szkole.</p></template><template v-else><label>Priorytet<select v-model="form.severity"><option value="critical">Poważny — natychmiastowa reakcja</option><option value="warning">Ostrzegawczy</option><option value="info">Informacyjny</option></select></label><label>Powiązana procedura<select v-model="form.procedureId" required><option disabled value="">Wybierz procedurę</option><option v-for="p in procedures" :key="p.id" :value="p.id">{{ p.name }}</option></select></label><p v-if="!procedures.length" class="form-hint">Najpierw dodaj procedurę w bibliotece procedur.</p></template></template></template>
        <p v-if="error" class="error" role="alert">{{ error }}</p><div class="modal-footer"><button type="button" class="btn secondary" :disabled="busy" @click="close">Anuluj</button><button :class="['btn', ['launch', 'delete'].includes(modal.mode) ? 'danger' : 'primary']" :disabled="busy">{{ busy ? 'Zapisywanie…' : modal.mode === 'launch' ? 'Potwierdzam, uruchom alert' : modal.mode === 'delete' ? 'Usuń rekord' : modal.mode === 'resolve' ? 'Zakończ zdarzenie' : 'Zapisz zmiany' }}<Check v-if="!busy" :size="16"/></button></div>
      </form>
    </section></div>
  </div>
  <div v-if="toast" class="toast" role="status"><CheckCircle2 :size="20"/>{{ toast }}<button aria-label="Zamknij komunikat" @click="toast = ''"><X :size="16"/></button></div>
</template>
