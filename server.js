const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Load .env without external dependencies (works on Node.js 18+).
function loadEnvFile() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index < 1) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('\"') && value.endsWith('\"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!Object.prototype.hasOwnProperty.call(process.env, key)) process.env[key] = value;
  }
}
loadEnvFile();

const PORT = Number(process.env.PORT || 3000);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'change-this-to-a-long-random-secret';
const TELEGRAM_BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const TELEGRAM_ADMIN_CHAT_ID = (process.env.TELEGRAM_ADMIN_CHAT_ID || '').trim();
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'submissions.json');
fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify({ bookings: [], reviews: [] }, null, 2));
const rateMap = new Map();
const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'application/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.ico':'image/x-icon' };
const clean = (value, max = 500) => String(value ?? '').trim().replace(/[<>]/g, '').slice(0, max);
const validPhone = phone => /^[+\d()\s-]{7,25}$/.test(phone);
const readData = () => JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
const writeData = data => fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()', 'Cache-Control': type.includes('text/html') ? 'no-cache' : 'public, max-age=300' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''; let size = 0;
    req.on('data', chunk => { size += chunk.length; if (size > 20000) { reject(new Error('Слишком большой запрос.')); req.destroy(); return; } body += chunk; });
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('Некорректный JSON.')); } });
    req.on('error', reject);
  });
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
}
async function telegramApi(method, payload = {}, timeoutMs = 15000) {
  if (!TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN не настроен');
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) throw new Error(result.description || `Telegram API error (${response.status})`);
  return result.result;
}
async function notifyTelegramBooking(booking) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_ADMIN_CHAT_ID) {
    console.log('Telegram booking notifications skipped: configure TELEGRAM_BOT_TOKEN and TELEGRAM_ADMIN_CHAT_ID in .env');
    return false;
  }
  const dateTime = [booking.date, booking.time].filter(Boolean).map(escapeHtml).join(' в ') || 'Клиент ещё не выбрал';
  const text = [
    '🚘 <b>НОВАЯ ЗАПИСЬ НА САЙТЕ</b>',
    `<b>Заявка:</b> <code>${escapeHtml(booking.id)}</code>`,
    `<b>Клиент:</b> ${escapeHtml(booking.name)}`,
    `<b>Телефон:</b> ${escapeHtml(booking.phone)}`,
    `<b>Услуга:</b> ${escapeHtml(booking.service)}`,
    `<b>Автомобиль:</b> ${escapeHtml(booking.car || 'Не указан')}`,
    `<b>Дата и время:</b> ${dateTime}`,
    `<b>Комментарий:</b> ${escapeHtml(booking.comment || 'Нет')}`,
    `<b>Получена:</b> ${escapeHtml(new Date(booking.createdAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }))}`
  ].join('\n');
  await telegramApi('sendMessage', {
    chat_id: TELEGRAM_ADMIN_CHAT_ID,
    text,
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: [[
      { text: '✅ Подтвердить', callback_data: `booking:confirmed:${booking.id}` },
      { text: '❌ Отклонить', callback_data: `booking:cancelled:${booking.id}` }
    ], [
      { text: '📞 Связались', callback_data: `booking:contacted:${booking.id}` }
    ]] }
  });
  return true;
}
async function processTelegramUpdate(update) {
  if (update.message?.text?.startsWith('/start')) {
    const chatId = String(update.message.chat?.id ?? '');
    const configured = TELEGRAM_ADMIN_CHAT_ID && chatId === TELEGRAM_ADMIN_CHAT_ID;
    const text = configured
      ? '✅ Бот подключён. Новые заявки с сайта ОНИКС Детейлинг будут приходить сюда.'
      : `Ваш Telegram Chat ID: <code>${escapeHtml(chatId)}</code>\n\nЧтобы получать заявки, добавьте этот ID в переменную <code>TELEGRAM_ADMIN_CHAT_ID</code> в файле <code>.env</code> на сервере, затем перезапустите сайт. Не публикуйте токен бота.`;
    await telegramApi('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' });
    return;
  }
  const query = update.callback_query;
  if (!query) return;
  const chatId = String(query.message?.chat?.id ?? '');
  if (!TELEGRAM_ADMIN_CHAT_ID || chatId !== TELEGRAM_ADMIN_CHAT_ID) {
    await telegramApi('answerCallbackQuery', { callback_query_id: query.id, text: 'Нет доступа к управлению заявками.', show_alert: true }).catch(() => {});
    return;
  }
  const match = String(query.data || '').match(/^booking:(confirmed|cancelled|contacted):([\w-]{10,80})$/);
  if (!match) {
    await telegramApi('answerCallbackQuery', { callback_query_id: query.id, text: 'Неизвестное действие.' }).catch(() => {});
    return;
  }
  const [, status, id] = match;
  const data = readData();
  const booking = data.bookings.find(item => item.id === id);
  if (!booking) {
    await telegramApi('answerCallbackQuery', { callback_query_id: query.id, text: 'Заявка не найдена.', show_alert: true }).catch(() => {});
    return;
  }
  booking.status = status;
  booking.updatedAt = new Date().toISOString();
  writeData(data);
  const labels = { confirmed: 'подтверждена', cancelled: 'отклонена', contacted: 'отмечена как «с клиентом связались»' };
  await telegramApi('answerCallbackQuery', { callback_query_id: query.id, text: `Заявка ${labels[status]}.` });
  const originalText = query.message?.text || query.message?.caption || 'Заявка ОНИКС Детейлинг';
  await telegramApi('editMessageText', {
    chat_id: chatId,
    message_id: query.message.message_id,
    text: `${originalText}\n\n<b>Статус:</b> ${escapeHtml(labels[status])}`,
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: [] }
  }).catch(async () => {
    await telegramApi('editMessageReplyMarkup', { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
  });
}
let telegramPollingStarted = false;
async function pollTelegramUpdates() {
  if (telegramPollingStarted || !TELEGRAM_BOT_TOKEN) return;
  telegramPollingStarted = true;
  let offset = 0;
  console.log(`Telegram bot polling enabled${TELEGRAM_ADMIN_CHAT_ID ? ' (admin chat configured)' : ' (send /start to the bot to get chat ID)'}.`);
  while (true) {
    try {
      const updates = await telegramApi('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'callback_query'] }, 35000);
      for (const update of updates) {
        offset = Math.max(offset, update.update_id + 1);
        try { await processTelegramUpdate(update); }
        catch (error) { console.error('Telegram update handling failed:', error.message); }
      }
    } catch (error) {
      console.error('Telegram polling error:', error.message);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

function adminAuth(req, url) {
  const header = req.headers.authorization || '';
  const token = header.replace(/^Bearer\s+/i, '') || url.searchParams.get('token') || '';
  if (!process.env.ADMIN_TOKEN || ADMIN_TOKEN === 'change-this-to-a-long-random-secret') return false;
  const a = Buffer.from(token); const b = Buffer.from(ADMIN_TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);
  if (pathname.startsWith('/api/')) {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
    const now = Date.now(); const record = rateMap.get(ip) || { count: 0, start: now };
    if (now - record.start > 10 * 60 * 1000) { record.count = 0; record.start = now; }
    record.count += 1; rateMap.set(ip, record);
    if (record.count > 60) return send(res, 429, { error: 'Слишком много запросов. Попробуйте позже.' });
  }
  try {
    if (req.method === 'GET' && pathname === '/api/health') return send(res, 200, { ok: true, service: 'onyx-detailing-site' });
    if (req.method === 'POST' && pathname === '/api/bookings') {
      const b = await readBody(req);
      const name = clean(b.name, 80), phone = clean(b.phone, 25), service = clean(b.service, 100);
      const date = clean(b.date, 20), time = clean(b.time, 20), car = clean(b.car, 100), comment = clean(b.comment, 1000);
      if (!name || !phone || !validPhone(phone) || !service) return send(res, 400, { error: 'Укажите имя, корректный телефон и услугу.' });
      if (b.website) return send(res, 400, { error: 'Не удалось отправить заявку.' });
      const data = readData();
      const booking = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), status: 'new', name, phone, service, date, time, car, comment };
      data.bookings.unshift(booking); writeData(data);
      // Booking is persisted first. Telegram delivery failure must never lose or reject the customer's request.
      notifyTelegramBooking(booking).then(sent => { if (sent) console.log(`Telegram notification sent for booking ${booking.id}`); }).catch(error => console.error(`Telegram notification failed for booking ${booking.id}:`, error.message));
      return send(res, 201, { ok: true, message: 'Заявка сохранена. Мы свяжемся с вами для подтверждения времени.', id: booking.id });
    }
    if (req.method === 'POST' && pathname === '/api/reviews') {
      const r = await readBody(req);
      const name = clean(r.name, 80), rating = Number(r.rating), text = clean(r.text, 1500), service = clean(r.service, 100);
      if (!name || !text || text.length < 8 || !Number.isInteger(rating) || rating < 1 || rating > 5) return send(res, 400, { error: 'Укажите имя, оценку и отзыв не короче 8 символов.' });
      if (r.website) return send(res, 400, { error: 'Не удалось отправить отзыв.' });
      const data = readData();
      data.reviews.unshift({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), status: 'pending', name, rating, text, service });
      writeData(data);
      return send(res, 201, { ok: true, message: 'Спасибо! Отзыв отправлен на проверку перед публикацией.' });
    }
    if (pathname.startsWith('/api/admin/')) {
      if (!adminAuth(req, url)) return send(res, 401, { error: 'Нет доступа. Настройте ADMIN_TOKEN в окружении.' });
      if (req.method === 'GET' && pathname === '/api/admin/data') return send(res, 200, readData());
      const reviewMatch = pathname.match(/^\/api\/admin\/reviews\/([^/]+)$/);
      if (req.method === 'PATCH' && reviewMatch) {
        const body = await readBody(req); const status = clean(body.status, 20);
        if (!['approved', 'rejected', 'pending'].includes(status)) return send(res, 400, { error: 'Недопустимый статус.' });
        const data = readData(); const review = data.reviews.find(x => x.id === reviewMatch[1]);
        if (!review) return send(res, 404, { error: 'Отзыв не найден.' });
        review.status = status; writeData(data); return send(res, 200, { ok: true, review });
      }
      const bookingMatch = pathname.match(/^\/api\/admin\/bookings\/([^/]+)$/);
      if (req.method === 'PATCH' && bookingMatch) {
        const body = await readBody(req); const status = clean(body.status, 20);
        if (!['new', 'contacted', 'confirmed', 'completed', 'cancelled'].includes(status)) return send(res, 400, { error: 'Недопустимый статус.' });
        const data = readData(); const booking = data.bookings.find(x => x.id === bookingMatch[1]);
        if (!booking) return send(res, 404, { error: 'Заявка не найдена.' });
        booking.status = status; writeData(data); return send(res, 200, { ok: true, booking });
      }
      return send(res, 404, { error: 'API endpoint not found.' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Метод не поддерживается.' });
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const file = path.resolve(PUBLIC_DIR, relative);
    if (!file.startsWith(PUBLIC_DIR + path.sep) && file !== path.join(PUBLIC_DIR, 'index.html')) return send(res, 403, { error: 'Forbidden' });
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, { error: 'Not found' });
    const type = mime[path.extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()', 'Cache-Control': type.includes('text/html') ? 'no-cache' : 'public, max-age=300' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  } catch (error) {
    if (!res.headersSent) send(res, 500, { error: 'Внутренняя ошибка сервера.' });
    console.error(error.message);
  }
});
server.listen(PORT, '0.0.0.0', () => {
  console.log(`ОНИКС Детейлинг site running on http://localhost:${PORT}`);
  if (TELEGRAM_BOT_TOKEN) pollTelegramUpdates();
  else console.log('Telegram notifications are disabled: TELEGRAM_BOT_TOKEN is missing.');
});
