// Заявки отправляются в защищённую Supabase Edge Function; секретные ключи
// остаются только на сервере и не попадают в этот файл.
const FORM_ENDPOINT = 'https://zbpcsfpyjdvonpfajwdb.supabase.co/functions/v1/submit-lead';
const clean = (value, max) => String(value || '').trim().slice(0, max);

document.getElementById('year').textContent = new Date().getFullYear();

document.getElementById('leadForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form).entries());
  // Ловушка для ботов: люди это поле не видят и не заполняют
  if (data.hp_field) { form.reset(); return; }
  const notice = document.getElementById('notice');
  const button = form.querySelector('button[type="submit"]');
  if (button.disabled) return;
  const label = button.innerHTML;
  button.disabled = true;
  button.textContent = 'Отправляем…';
  notice.style.display = 'none';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const payload = {
      name: clean(data.name, 100),
      contact: clean(data.contact, 120),
      business_type: clean(data.business, 60),
      message: clean(data.task, 1500),
      website: ''
    };
    const response = await fetch(FORM_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
      signal: controller.signal,
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({}));
    if (response.status === 429) throw new Error('rate_limited');
    if (!response.ok || !result.ok) throw new Error('Request failed');
    notice.textContent = result.notification === 'sent'
      ? 'Спасибо! Заявка отправлена. Мы свяжемся с вами.'
      : 'Заявка сохранена. Уведомление временно задерживается, но мы получили ваши данные.';
    form.reset();
  } catch (error) {
    notice.textContent = error.message === 'rate_limited'
      ? 'Слишком много заявок с вашего адреса. Попробуйте через 10 минут или напишите нам в Telegram.'
      : 'Не удалось отправить заявку. Попробуйте ещё раз или свяжитесь с нами в Telegram.';
  } finally {
    clearTimeout(timer);
    notice.style.display = 'block';
    button.disabled = false;
    button.innerHTML = label;
  }
});
