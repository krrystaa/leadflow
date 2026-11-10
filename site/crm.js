import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/+esm';

const SUPABASE_URL = 'https://zbpcsfpyjdvonpfajwdb.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_2yDXgsYKgXj6oNTQXsZOiw_aMvAcoyp';
const INDUSTRIES = ['Производство','Оптовые поставки','Логистика','Строительство и ремонт','Мебельное производство'];
const STATUSES = ['Новая компания','На проверке','Первичный контакт','Связались с ЛПР','Заинтересован','Переговоры','КП отправлено','Клиент','Отказ','Повторный контакт'];
const PRIORITIES = ['Высокий','Средний','Низкий'];

// Public publishable key only. Database access is restricted by RLS + verified email + MFA AAL2.
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: window.localStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce'
  }
});

const $ = (id) => document.getElementById(id);
const views = ['authView','mfaSetupView','mfaChallengeView','workspace'];
let currentSession = null;
let currentUser = null;
let currentView = 'overview';
let companies = [];
let tasks = [];
let requests = [];
let interactions = [];
let challengeFactorId = null;
let setupFactorId = null;
let isHandlingSession = false;
let idleTimer = null;
let lastActivityWrite = 0;
const IDLE_LIMIT_MS = 30 * 60 * 1000;
let currentCompanyFilter = { q:'', industry:'', status:'' };

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function showOnly(id) {
  for (const name of views) $(name).hidden = name !== id;
  $('boot').hidden = true;
}
function setMessage(id, message, isError=false) {
  const el = $(id); el.textContent = message || ''; el.classList.toggle('error', !!isError);
}
function toast(message, isError=false) {
  const el = $('toast'); el.textContent = message; el.classList.toggle('error', !!isError);
  el.style.display = 'block';
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => { el.style.display = 'none'; }, 3500);
}
function dateLabel(value, includeTime=true) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('ru-RU', includeTime ? {dateStyle:'short',timeStyle:'short'} : {dateStyle:'medium'}).format(d);
}
function localInputDate(value) {
  if (!value) return '';
  const d = new Date(value); if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function badge(value) {
  const cls = value === 'Клиент' || value === 'Заинтересован' || value === 'Выполнена' ? 'good' :
    value === 'Отказ' || value === 'Отменена' ? 'bad' :
    value === 'Высокий' || value === 'Переговоры' || value === 'КП отправлено' ? 'warn' : '';
  return `<span class="badge ${cls}">${escapeHtml(value || '—')}</span>`;
}
function registerActivity() {
  const now = Date.now();
  if (now - lastActivityWrite > 30000) {
    try { localStorage.setItem('leadflow_crm_last_active', String(now)); } catch (_) {}
    lastActivityWrite = now;
  }
  if (idleTimer) window.clearTimeout(idleTimer);
  if (currentSession) idleTimer = window.setTimeout(() => signOut(), IDLE_LIMIT_MS);
}
function checkIdleSession() {
  try {
    const last = Number(localStorage.getItem('leadflow_crm_last_active') || 0);
    return !!last && (Date.now() - last > IDLE_LIMIT_MS);
  } catch (_) { return true; }
}

async function enterSession(session) {
  if (isHandlingSession) return;
  isHandlingSession = true;
  try {
    currentSession = session;
    if (!session) {
      currentUser = null; showOnly('authView'); return;
    }
    currentUser = session.user;
    $('signedEmail').textContent = session.user.email || '';
    const { data: assurance, error: assuranceError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assuranceError) throw assuranceError;
    if (assurance?.currentLevel === 'aal2') {
      showOnly('workspace');
      registerActivity();
      await refreshAll();
      return;
    }
    const { data: factorData, error: factorsError } = await supabase.auth.mfa.listFactors();
    if (factorsError) throw factorsError;
    const verified = [...(factorData?.totp || []), ...(factorData?.phone || [])].find(f => f.status === 'verified');
    if (verified) {
      challengeFactorId = verified.id;
      $('challengeCode').value = '';
      setMessage('challengeMessage','');
      showOnly('mfaChallengeView');
      return;
    }
    const unverified = [...(factorData?.totp || []), ...(factorData?.phone || [])].find(f => f.status !== 'verified');
    if (unverified) {
      // Remove an abandoned, unverified enrollment and start a fresh QR setup.
      const { error: removeError } = await supabase.auth.mfa.unenroll({ factorId: unverified.id });
      if (removeError) throw new Error('Есть незавершённая настройка 2FA. Выйди и повтори вход; если ошибка повторится, напиши администратору Supabase.');
    }
    await startTotpEnrollment();
  } catch (error) {
    setMessage('authMessage', error.message || 'Не удалось проверить защищённую сессию.', true);
    if (currentSession) showOnly('authView');
  } finally {
    isHandlingSession = false;
  }
}

async function startTotpEnrollment() {
  setMessage('setupMessage','Создаём защищённый фактор…');
  showOnly('mfaSetupView');
  const { data, error } = await supabase.auth.mfa.enroll({ factorType:'totp', friendlyName:'LEADFLOW Admin' });
  if (error) throw error;
  setupFactorId = data.id;
  $('totpQr').src = data.totp.qr_code;
  $('totpSecret').textContent = data.totp.secret;
  $('setupCode').value = '';
  setMessage('setupMessage','Отсканируй QR-код и введи шестизначный код из приложения.');
}

async function verifyTotp(factorId, inputId, messageId, successMessage) {
  const code = $(inputId).value.trim().replace(/\s+/g,'');
  if (!/^\d{6}$/.test(code)) { setMessage(messageId,'Введи ровно 6 цифр.',true); return false; }
  setMessage(messageId,'Проверяем код…');
  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
  if (challengeError) { setMessage(messageId, challengeError.message, true); return false; }
  const { error: verifyError } = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.id, code });
  if (verifyError) { setMessage(messageId,'Код не подошёл. Проверь приложение и попробуй ещё раз.',true); return false; }
  await supabase.auth.refreshSession();
  setMessage(messageId,successMessage || 'Защита подтверждена. Открываем CRM…');
  return true;
}

async function doSignIn() {
  const btn = $('sendLink');
  const email = $('loginEmail').value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setMessage('authMessage','Введи email.',true); return; }
  btn.disabled = true;
  setMessage('authMessage','Отправляем защищённую ссылку…');
  try {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser:false, emailRedirectTo:`${location.origin}/crm.html` }
    });
    if (error && error.status === 429) throw error;
    // Одинаковый ответ для любого адреса: так нельзя выяснить, какой email разрешён.
    setMessage('authMessage','Если адрес разрешён, ссылка отправлена. Открой письмо на этом устройстве и перейди по ссылке. Потом потребуется код 2FA.');
  } catch (error) {
    setMessage('authMessage','Слишком много запросов ссылки. Подожди и повтори: лимит почты Supabase может сниматься до часа.',true);
  } finally { btn.disabled = false; }
}

async function signOut() {
  try { await supabase.auth.signOut({scope:'local'}); } catch (_) {}
  if (idleTimer) window.clearTimeout(idleTimer);
  try { localStorage.removeItem('leadflow_crm_last_active'); } catch (_) {}
  currentSession = null; currentUser = null; companies=[]; tasks=[]; requests=[]; interactions=[];
  showOnly('authView');
  setMessage('authMessage','Ты вышел из CRM.');
}

async function refreshAll() {
  const [c,t,r,i] = await Promise.all([
    supabase.from('crm_companies').select('*').order('created_at',{ascending:false}).limit(1000),
    supabase.from('crm_tasks').select('*').order('due_at',{ascending:true}).limit(1000),
    supabase.from('lead_requests').select('*').order('created_at',{ascending:false}).limit(250),
    supabase.from('crm_interactions').select('*').order('occurred_at',{ascending:false}).limit(500)
  ]);
  const failed = [c,t,r,i].find(x => x.error);
  if (failed) {
    toast('Нет доступа к данным или ошибка загрузки.', true);
    if (/permission|policy|row-level|jwt/i.test(failed.error.message || '')) await signOut();
    return;
  }
  companies = c.data || []; tasks = t.data || []; requests = r.data || []; interactions = i.data || [];
  $('companyNavCount').textContent = companies.length;
  $('taskNavCount').textContent = tasks.filter(x=>x.status==='Открыта').length;
  $('requestNavCount').textContent = requests.length;
  renderCurrentView();
}

function renderCurrentView() {
  if (currentView === 'overview') renderOverview();
  if (currentView === 'companies') renderCompanies();
  if (currentView === 'tasks') renderTasks();
  if (currentView === 'requests') renderRequests();
}
function metric(label,value,foot) {
  return `<article class="stat-card"><span>${escapeHtml(label)}</span><strong>${value}</strong><small>${escapeHtml(foot)}</small></article>`;
}
function renderOverview() {
  const openTasks = tasks.filter(t=>t.status==='Открыта');
  const dueTasks = openTasks.filter(t=>t.due_at && new Date(t.due_at) <= new Date());
  const active = companies.filter(c=>['Связались с ЛПР','Заинтересован','Переговоры','КП отправлено'].includes(c.status));
  const clients = companies.filter(c=>c.status==='Клиент');
  const recent = interactions.slice(0,7);
  const taskRows = openTasks.slice(0,7).map(t=>`<div class="task-item"><div><strong>${escapeHtml(t.title)}</strong><small>${escapeHtml(t.description || '')} · ${dateLabel(t.due_at)}</small></div><button data-done-task="${t.id}">Готово</button></div>`).join('') || '<div class="empty">Открытых задач пока нет.</div>';
  const recentRows = recent.map(i=>{
    const company = companies.find(c=>c.id===i.company_id);
    return `<div class="task-item"><div><strong>${escapeHtml(company?.company_name || 'Компания')}</strong><small>${escapeHtml(i.channel)} · ${escapeHtml(i.outcome || '')} · ${dateLabel(i.occurred_at)}</small></div>${badge(i.channel)}</div>`;
  }).join('') || '<div class="empty">История взаимодействий появится после первых звонков.</div>';
  $('view-overview').innerHTML = `
    <div class="stats">${metric('Компании',companies.length,'В базе LEADFLOW')}${metric('Активные переговоры',active.length,'Связались, интерес, переговоры и КП')}${metric('Клиенты',clients.length,'Заключённые договорённости')}${metric('Задачи просрочены',dueTasks.length,'Требуют внимания сегодня')}</div>
    <div class="dashboard-grid"><section class="panel"><div class="panel-head"><h2>Ближайшие задачи</h2><button class="link-button" data-go="tasks">Все задачи →</button></div><div class="task-list">${taskRows}</div></section>
    <section class="panel"><div class="panel-head"><h2>Последние касания</h2><button class="link-button" data-go="companies">Компании →</button></div><div class="task-list">${recentRows}</div></section></div>
    <p class="footnote">Показатели обновляются из базы Supabase после входа с подтверждённым вторым фактором.</p>`;
}
function renderCompanies() {
  const q = currentCompanyFilter.q.toLowerCase();
  const rows = companies.filter(c=>{
    const hay = [c.company_name,c.city,c.region,c.phone,c.email,c.decision_maker].join(' ').toLowerCase();
    return (!q || hay.includes(q)) && (!currentCompanyFilter.industry || c.industry===currentCompanyFilter.industry) && (!currentCompanyFilter.status || c.status===currentCompanyFilter.status);
  });
  const body = rows.map(c=>`<tr>
    <td><button class="company-link" data-company="${c.id}">${escapeHtml(c.company_name)}</button><div class="subtle">${escapeHtml([c.city,c.region].filter(Boolean).join(', '))}</div></td>
    <td>${escapeHtml(c.industry)}</td><td>${escapeHtml(c.decision_maker || 'Не найден')}<div class="subtle">${escapeHtml(c.decision_maker_role || '')}</div></td>
    <td>${badge(c.status)}</td><td>${badge(c.priority)}</td><td>${dateLabel(c.next_contact_at)}</td>
  </tr>`).join('') || '<tr><td colspan="6" class="empty">Компаний по выбранным условиям не найдено.</td></tr>';
  $('view-companies').innerHTML = `
    <div class="toolbar"><input id="companySearch" class="control search" placeholder="Поиск по названию, городу, телефону…" value="${escapeHtml(currentCompanyFilter.q)}">
      <select id="industryFilter" class="control"><option value="">Все отрасли</option>${INDUSTRIES.map(x=>`<option ${currentCompanyFilter.industry===x?'selected':''}>${escapeHtml(x)}</option>`).join('')}</select>
      <select id="statusFilter" class="control"><option value="">Все статусы</option>${STATUSES.map(x=>`<option ${currentCompanyFilter.status===x?'selected':''}>${escapeHtml(x)}</option>`).join('')}</select>
      <button class="btn btn-light" id="exportCsv">Экспорт CSV</button><button class="btn btn-light" id="templateCsv">Шаблон CSV</button><label class="btn btn-light" for="importCsv">Импорт CSV</label><input id="importCsv" class="hidden-file" type="file" accept=".csv,text/csv"><button class="btn btn-primary" id="newCompany">＋ Добавить</button></div>
    <div class="table-wrap"><table class="data-table"><thead><tr><th>Компания</th><th>Отрасль</th><th>ЛПР</th><th>Статус</th><th>Приоритет</th><th>Следующий контакт</th></tr></thead><tbody>${body}</tbody></table></div>
    <p class="footnote">Всего в базе: ${companies.length}. В таблице: ${rows.length}. Удаление записей из интерфейса отключено, чтобы случайно не потерять историю.</p>`;
  $('companySearch').addEventListener('input',e=>{currentCompanyFilter.q=e.target.value; renderCompanies(); const el=$('companySearch');el.focus();el.setSelectionRange(el.value.length,el.value.length);});
  $('industryFilter').addEventListener('change',e=>{currentCompanyFilter.industry=e.target.value;renderCompanies();});
  $('statusFilter').addEventListener('change',e=>{currentCompanyFilter.status=e.target.value;renderCompanies();});
  $('newCompany').addEventListener('click',()=>openCompanyModal());
  $('exportCsv').addEventListener('click',exportCompaniesCsv);
  $('templateCsv').addEventListener('click',downloadCsvTemplate);
  $('importCsv').addEventListener('change',importCompaniesCsv);
}
function renderTasks() {
  const open = tasks.filter(t=>t.status==='Открыта');
  const done = tasks.filter(t=>t.status!=='Открыта');
  const renderTask = t=>`<div class="task-item"><div><strong>${escapeHtml(t.title)}</strong><small>${escapeHtml(t.description || '')}<br>${dateLabel(t.due_at)}${t.company_id ? ' · '+escapeHtml(companies.find(c=>c.id===t.company_id)?.company_name || '') : ''}</small></div>${t.status==='Открыта'?`<button data-done-task="${t.id}">Отметить выполненной</button>`:badge(t.status)}</div>`;
  $('view-tasks').innerHTML = `<div class="toolbar"><span class="subtle">Открыто: ${open.length} · Завершено: ${done.length}</span><span class="grow"></span><button class="btn btn-primary" id="newTask">＋ Новая задача</button></div><div class="split"><section class="panel"><div class="panel-head"><h2>Открытые задачи</h2></div><div class="task-list">${open.map(renderTask).join('') || '<div class="empty">Нет открытых задач.</div>'}</div></section><section class="panel"><div class="panel-head"><h2>Завершённые</h2></div><div class="task-list">${done.slice(0,20).map(renderTask).join('') || '<div class="empty">Пока нет завершённых задач.</div>'}</div></section></div>`;
  $('newTask').addEventListener('click',openTaskModal);
}
function renderRequests() {
  const html = requests.map(r=>`<article class="request-item"><div><strong>${escapeHtml(r.name)} · ${escapeHtml(r.business_type)}</strong><small>${escapeHtml(r.contact)} · ${dateLabel(r.created_at)}<br>${escapeHtml(r.message || 'Без комментария')}</small></div><button data-convert-request="${r.id}">Создать карточку</button></article>`).join('') || '<div class="empty">Новых заявок с сайта пока нет.</div>';
  $('view-requests').innerHTML = `<section class="panel"><div class="panel-head"><h2>Входящие заявки с сайта</h2><span class="subtle">${requests.length} записей</span></div><div class="plain-list">${html}</div><p class="footnote">Заявки не удаляются при создании карточки компании. После обработки добавь заметку или задачу, чтобы не потерять контекст.</p></section>`;
}

function setView(view) {
  currentView = view;
  const titles = {overview:'Обзор',companies:'Компании',tasks:'Задачи',requests:'Заявки с сайта'};
  $('pageTitle').textContent = titles[view] || 'CRM';
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
  for (const v of ['overview','companies','tasks','requests']) $(`view-${v}`).hidden = v !== view;
  renderCurrentView();
}
function modal(content) {
  $('modalRoot').innerHTML = `<div class="modal-backdrop" id="modalBackdrop"><section class="modal" role="dialog" aria-modal="true">${content}</section></div>`;
  $('modalBackdrop').addEventListener('click',e=>{if(e.target.id==='modalBackdrop')closeModal();});
  $('modalClose')?.addEventListener('click',closeModal);
}
function closeModal(){ $('modalRoot').innerHTML=''; }
function field(label,name,value='',type='text',opts={}) {
  const full = opts.full ? 'full' : '';
  const safe = escapeHtml(value ?? '');
  if (type === 'select') return `<div class="${full}"><label>${escapeHtml(label)}</label><select class="control" name="${name}" ${opts.required?'required':''}>${opts.items.map(x=>`<option value="${escapeHtml(x)}" ${value===x?'selected':''}>${escapeHtml(x)}</option>`).join('')}</select></div>`;
  if (type === 'textarea') return `<div class="${full}"><label>${escapeHtml(label)}</label><textarea class="control" name="${name}" ${opts.required?'required':''}>${safe}</textarea></div>`;
  return `<div class="${full}"><label>${escapeHtml(label)}</label><input class="control" name="${name}" type="${type}" value="${safe}" ${opts.required?'required':''} ${opts.step?`step="${opts.step}"`:''}></div>`;
}
function openCompanyModal(company=null, preset={}) {
  const c = company || preset;
  modal(`<div class="modal-head"><h2>${company?'Редактировать компанию':'Новая компания'}</h2><button class="close-btn" id="modalClose" aria-label="Закрыть">×</button></div>
    <form id="companyForm"><div class="form-grid">
      ${field('Название компании *','company_name',c.company_name||'','text',{required:true,full:true})}
      ${field('Отрасль *','industry',c.industry||INDUSTRIES[0],'select',{items:INDUSTRIES,required:true})}
      ${field('Приоритет','priority',c.priority||'Средний','select',{items:PRIORITIES})}
      ${field('Город','city',c.city||'')}${field('Регион','region',c.region||'')}
      ${field('Сайт','website',c.website||'','url')}${field('Телефон','phone',c.phone||'','text')}
      ${field('Email','email',c.email||'','email')}${field('ЛПР','decision_maker',c.decision_maker||'')}
      ${field('Должность ЛПР','decision_maker_role',c.decision_maker_role||'')}
      ${field('Статус','status',c.status||'Новая компания','select',{items:STATUSES})}
      ${field('Источник','source_url',c.source_url||'','url')}${field('Тип источника','source_type',c.source_type||'')}
      ${field('Почему подходит','fit_reason',c.fit_reason||'','textarea',{full:true})}
      ${field('Признаки / сигналы роста','growth_signals',c.growth_signals||'','textarea',{full:true})}
      ${field('Следующий контакт','next_contact_at',localInputDate(c.next_contact_at),'datetime-local')}
      ${field('Заметки','notes',c.notes||'','textarea',{full:true})}
    </div><div class="modal-actions"><button type="button" class="btn btn-light" id="cancelModal">Отмена</button><button type="submit" class="btn btn-primary">${company?'Сохранить':'Создать компанию'}</button></div></form>`);
  $('cancelModal').addEventListener('click',closeModal);
  $('companyForm').addEventListener('submit',async e=>{
    e.preventDefault(); const btn=e.currentTarget.querySelector('button[type=submit]');btn.disabled=true;
    const f=Object.fromEntries(new FormData(e.currentTarget));
    const payload={...f, next_contact_at:f.next_contact_at?new Date(f.next_contact_at).toISOString():null};
    delete payload.created_by;
    try{
      let result;
      if(company) result=await supabase.from('crm_companies').update(payload).eq('id',company.id).select().single();
      else result=await supabase.from('crm_companies').insert(payload).select().single();
      if(result.error)throw result.error;
      closeModal(); await refreshAll(); toast(company?'Карточка обновлена.':'Компания добавлена в CRM.');
    }catch(err){toast(err.message||'Не удалось сохранить компанию.',true);btn.disabled=false;}
  });
}

async function openCompanyDetail(id) {
  const c=companies.find(x=>x.id===id); if(!c)return;
  const {data: logs,error}=await supabase.from('crm_interactions').select('*').eq('company_id',id).order('occurred_at',{ascending:false}).limit(100);
  if(error){toast(error.message,true);return;}
  const logHtml=(logs||[]).map(x=>`<div class="task-item"><div><strong>${escapeHtml(x.channel)} · ${escapeHtml(x.outcome||'')}</strong><small>${escapeHtml(x.summary)}<br>${escapeHtml(x.contact_person||'')} · ${dateLabel(x.occurred_at)}${x.next_step?' · Следующий шаг: '+escapeHtml(x.next_step):''}</small></div></div>`).join('')||'<div class="empty">Истории пока нет. Добавь первое касание.</div>';
  modal(`<div class="modal-head"><div><div class="eyebrow">КАРТОЧКА КОМПАНИИ</div><h2>${escapeHtml(c.company_name)}</h2></div><button class="close-btn" id="modalClose">×</button></div>
    <div class="detail-grid"><div class="detail-block"><small>Отрасль</small><strong>${escapeHtml(c.industry)}</strong></div><div class="detail-block"><small>Статус / приоритет</small><strong>${escapeHtml(c.status)} · ${escapeHtml(c.priority)}</strong></div><div class="detail-block"><small>Телефон</small><strong>${escapeHtml(c.phone||'—')}</strong></div><div class="detail-block"><small>ЛПР</small><strong>${escapeHtml(c.decision_maker||'Не найден')} ${escapeHtml(c.decision_maker_role||'')}</strong></div><div class="detail-block"><small>Сайт</small><strong>${c.website?`<a href="${escapeHtml(c.website)}" target="_blank" rel="noopener noreferrer">${escapeHtml(c.website)}</a>`:'—'}</strong></div><div class="detail-block"><small>Следующий контакт</small><strong>${dateLabel(c.next_contact_at)}</strong></div></div>
    <p class="subtle">${escapeHtml(c.fit_reason||'Причина включения в базу не заполнена.')}</p>
    <div class="modal-actions"><button id="editCompany" class="btn btn-light">Редактировать карточку</button></div><div class="divider"></div>
    <div class="split"><section><h3 class="section-title">История касаний</h3><div class="plain-list mt10">${logHtml}</div></section>
    <section><h3 class="section-title">Добавить касание</h3><form id="interactionForm" class="form-grid mt10">
      ${field('Канал','channel','Звонок','select',{items:['Звонок','Email','Мессенджер','Встреча','Другое']})}
      ${field('Результат','outcome','','text')}${field('Контактное лицо','contact_person',c.decision_maker||'')}
      ${field('Краткий итог *','summary','','textarea',{required:true,full:true})}${field('Следующий шаг','next_step','','textarea',{full:true})}
      ${field('Перезвонить / контакт','next_contact_at','','datetime-local')}
      <div class="full"><button class="btn btn-primary" type="submit">Сохранить касание</button></div>
    </form></section></div>`);
  $('editCompany').addEventListener('click',()=>openCompanyModal(c));
  $('interactionForm').addEventListener('submit',async e=>{
    e.preventDefault();const f=Object.fromEntries(new FormData(e.currentTarget));
    const payload={...f,company_id:id,next_contact_at:f.next_contact_at?new Date(f.next_contact_at).toISOString():null};
    try{
      const {error:insertError}=await supabase.from('crm_interactions').insert(payload);if(insertError)throw insertError;
      const update={last_contact_at:new Date().toISOString()};if(payload.next_contact_at)update.next_contact_at=payload.next_contact_at;
      const {error:updateError}=await supabase.from('crm_companies').update(update).eq('id',id);if(updateError)throw updateError;
      closeModal();await refreshAll();toast('Касание добавлено в историю.');
    }catch(err){toast(err.message||'Не удалось сохранить касание.',true);}
  });
}

function openTaskModal() {
  const opts=companies.map(c=>`<option value="${c.id}">${escapeHtml(c.company_name)}</option>`).join('');
  modal(`<div class="modal-head"><h2>Новая задача</h2><button class="close-btn" id="modalClose">×</button></div>
    <form id="taskForm"><div class="form-grid">${field('Задача *','title','','text',{required:true,full:true})}${field('Компания','company_id','','select',{items:['',...companies.map(c=>c.id)]})}${field('Срок','due_at','','datetime-local')}${field('Описание','description','','textarea',{full:true})}</div><div class="modal-actions"><button type="button" class="btn btn-light" id="cancelModal">Отмена</button><button class="btn btn-primary" type="submit">Создать задачу</button></div></form>`);
  const select=$('taskForm').elements.company_id;
  select.innerHTML=`<option value="">Без привязки</option>${opts}`;
  $('cancelModal').addEventListener('click',closeModal);
  $('taskForm').addEventListener('submit',async e=>{
    e.preventDefault();const f=Object.fromEntries(new FormData(e.currentTarget));
    const payload={title:f.title,company_id:f.company_id||null,description:f.description||null,due_at:f.due_at?new Date(f.due_at).toISOString():null};
    try{const {error}=await supabase.from('crm_tasks').insert(payload);if(error)throw error;closeModal();await refreshAll();setView('tasks');toast('Задача создана.');}catch(err){toast(err.message,true);}
  });
}

async function markTaskDone(id) {
  const {error}=await supabase.from('crm_tasks').update({status:'Выполнена',completed_at:new Date().toISOString()}).eq('id',id);
  if(error){toast(error.message,true);return;} await refreshAll();toast('Задача отмечена выполненной.');
}
function csvEscape(v){let s=String(v??'');if(/^[=@\t\r]/.test(s)||(/^[+\-]/.test(s)&&!/^[+\-]?\d[\d\s().\-]*$/.test(s)))s="'"+s;return /[;"\n\r]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;}
function downloadCsv(filename, content){const blob=new Blob(['\ufeff'+content],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;a.click();URL.revokeObjectURL(url);}
const CSV_FIELDS=['company_name','industry','city','region','website','phone','email','decision_maker','decision_maker_role','source_url','source_type','fit_reason','growth_signals','priority','status','next_contact_at','notes'];
function exportCompaniesCsv(){const lines=[CSV_FIELDS.join(';'),...companies.map(c=>CSV_FIELDS.map(k=>csvEscape(c[k])).join(';'))];downloadCsv('leadflow_companies_export.csv',lines.join('\r\n'));}
function downloadCsvTemplate(){const sample=['Пример ООО','Производство','Москва','Москва','https://example.ru','+7 000 000-00-00','sales@example.ru','','','https://example.ru/contacts','Официальный сайт','Почему компании может подойти LEADFLOW','Публичный признак','Средний','Новая компания','',''];downloadCsv('leadflow_import_template.csv',[CSV_FIELDS.join(';'),sample.map(csvEscape).join(';')].join('\r\n'));}
function parseCsv(text){
  const firstLine=(text.split(/\r?\n/,1)[0]||'');const delimiter=(firstLine.match(/;/g)||[]).length >= (firstLine.match(/,/g)||[]).length?';':',';
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){const ch=text[i];if(ch==='"'&&quoted&&text[i+1]==='"'){cell+='"';i++;}else if(ch==='"'){quoted=!quoted;}else if(ch===delimiter&&!quoted){row.push(cell);cell='';}else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x.trim()!==''))rows.push(row);row=[];cell='';}else cell+=ch;}
  row.push(cell);if(row.some(x=>x.trim()!==''))rows.push(row);return rows;
}
async function importCompaniesCsv(event){
  const file=event.target.files?.[0];if(!file)return;event.target.value='';
  if(file.size>2*1024*1024){toast('Файл больше 2 МБ. Раздели его на несколько частей.',true);return;}
  try{
    const rows=parseCsv((await file.text()).replace(/^\ufeff/,''));if(rows.length<2)throw new Error('В CSV нет строк с компаниями.');
    const headers=rows[0].map(h=>h.trim());const records=rows.slice(1).map(row=>Object.fromEntries(headers.map((h,i)=>[h,(row[i]||'').trim()])));
    const valid=records.filter(r=>r.company_name && INDUSTRIES.includes(r.industry)).map(r=>{
      const o={};for(const key of CSV_FIELDS)if(r[key]!==undefined)o[key]=r[key]||null;
      o.priority=PRIORITIES.includes(o.priority)?o.priority:'Средний';o.status=STATUSES.includes(o.status)?o.status:'Новая компания';
      if(o.next_contact_at){const d=new Date(o.next_contact_at);o.next_contact_at=Number.isNaN(d.getTime())?null:d.toISOString();}
      return o;
    });
    if(!valid.length)throw new Error('Не найдено строк с корректным company_name и одной из пяти отраслей. Используй шаблон CSV.');
    let inserted=0;for(let i=0;i<valid.length;i+=25){const {error}=await supabase.from('crm_companies').insert(valid.slice(i,i+25));if(error)throw error;inserted+=Math.min(25,valid.length-i);}
    await refreshAll();toast(`Импортировано компаний: ${inserted}.`);
  }catch(err){toast(err.message||'Ошибка импорта CSV.',true);}
}

// Global UI events
$('sendLink').addEventListener('click',doSignIn);
$('loginEmail').addEventListener('keydown',e=>{if(e.key==='Enter')doSignIn();});
$('verifySetup').addEventListener('click',async()=>{
  if(!setupFactorId)return;const ok=await verifyTotp(setupFactorId,'setupCode','setupMessage','Защита настроена.');
  if(ok){showOnly('workspace');await refreshAll();toast('2FA включена. Добро пожаловать в LEADFLOW CRM.');}
});
$('verifyChallenge').addEventListener('click',async()=>{
  if(!challengeFactorId)return;const ok=await verifyTotp(challengeFactorId,'challengeCode','challengeMessage','Вход подтверждён.');
  if(ok){showOnly('workspace');await refreshAll();toast('Вход подтверждён.');}
});
$('cancelSetup').addEventListener('click',signOut);
$('signOutFromChallenge').addEventListener('click',signOut);
$('signOut').addEventListener('click',signOut);
$('quickAdd').addEventListener('click',()=>openCompanyModal());
document.querySelectorAll('.nav-btn').forEach(btn=>btn.addEventListener('click',()=>setView(btn.dataset.view)));
document.addEventListener('click',async event=>{
  const companyButton=event.target.closest('[data-company]');if(companyButton){await openCompanyDetail(companyButton.dataset.company);return;}
  const doneButton=event.target.closest('[data-done-task]');if(doneButton){await markTaskDone(doneButton.dataset.doneTask);return;}
  const go=event.target.closest('[data-go]');if(go){setView(go.dataset.go);return;}
  const convert=event.target.closest('[data-convert-request]');if(convert){const r=requests.find(x=>x.id===convert.dataset.convertRequest);if(r){let industry=INDUSTRIES[0];if(/ремонт|строит/i.test(r.business_type))industry='Строительство и ремонт';if(/мебел/i.test(r.business_type))industry='Мебельное производство';openCompanyModal(null,{company_name:r.name,industry,phone:r.contact,fit_reason:`Входящая заявка с сайта LEADFLOW. Сфера: ${r.business_type}. Комментарий: ${r.message||'—'}`,source_type:'Заявка с сайта'});}return;}
});

document.addEventListener('pointerdown', registerActivity, {passive:true});
document.addEventListener('keydown', registerActivity);
document.addEventListener('touchstart', registerActivity, {passive:true});

supabase.auth.onAuthStateChange((event, session)=>{
  if(event==='SIGNED_IN'||event==='TOKEN_REFRESHED'||event==='USER_UPDATED'){
    // Defer to avoid calling Supabase Auth methods inside the auth event callback.
    Promise.resolve().then(()=>enterSession(session));
  }else if(event==='SIGNED_OUT'){
    currentSession=null;currentUser=null;showOnly('authView');
  }
});

(async()=>{
  try{
    if (checkIdleSession()) { try { await supabase.auth.signOut({scope:'local'}); } catch (_) {} }
    const {data,error}=await supabase.auth.getSession();if(error)throw error;
    if(data.session) await enterSession(data.session); else showOnly('authView');
  }catch(error){setMessage('authMessage',error.message||'Не удалось восстановить сессию.',true);showOnly('authView');}
})();
