(() => {
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const bookingDialog = $('#booking-dialog');
  const reviewForm = $('#review-form');
  const bookingForm = $('#booking-form');
  const toast = $('#toast');
  let selectedRating = 5;
  const gallery = [
    { src: 'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?auto=format&fit=crop&w=1600&q=90', alt: 'Автомобиль с глянцевым кузовом', caption: 'Кузов и блеск' },
    { src: 'https://images.unsplash.com/photo-1607860108855-64acf2078ed9?auto=format&fit=crop&w=1600&q=90', alt: 'Детейлинг автомобиля', caption: 'Детейлинг' },
    { src: 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=1600&q=90', alt: 'Спортивный автомобиль', caption: 'Эстетика' },
    { src: 'https://images.unsplash.com/photo-1507136566006-cfc505b114fc?auto=format&fit=crop&w=1600&q=90', alt: 'Интерьер автомобиля', caption: 'Интерьер' }
  ];
  let galleryIndex = 0;
  const galleryDialog = $('#gallery-dialog');
  function showToast(message) { toast.textContent = message; toast.classList.add('show'); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove('show'), 4200); }
  function openBooking(service = '') {
    if (service) $('select[name="service"]', bookingForm).value = service;
    if (typeof bookingDialog.showModal === 'function') bookingDialog.showModal();
    else bookingDialog.setAttribute('open', '');
    document.body.classList.add('modal-open');
  }
  function closeDialog(dialog) { if (dialog?.close) dialog.close(); else dialog?.removeAttribute('open'); if (!bookingDialog.open && !galleryDialog.open) document.body.classList.remove('modal-open'); }
  $$('[data-booking]').forEach(el => el.addEventListener('click', e => { e.preventDefault(); openBooking(); }));
  $$('[data-service]').forEach(el => el.addEventListener('click', () => openBooking(el.dataset.service)));
  $$('[data-close-modal]').forEach(el => el.addEventListener('click', () => closeDialog(bookingDialog)));
  bookingDialog.addEventListener('click', e => { if (e.target === bookingDialog) closeDialog(bookingDialog); });
  bookingDialog.addEventListener('close', () => { if (!galleryDialog.open) document.body.classList.remove('modal-open'); });
  $('#open-review');
  $$('[data-open-review]').forEach(el => el.addEventListener('click', () => { $('#review-form').scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(() => $('input[name="name"]', reviewForm).focus({ preventScroll: true }), 450); }));
  const menuButton = $('.menu-toggle'), nav = $('#nav-links');
  menuButton.addEventListener('click', () => { const open = nav.classList.toggle('open'); menuButton.setAttribute('aria-expanded', String(open)); menuButton.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню'); });
  $$('.nav-links a').forEach(a => a.addEventListener('click', () => { nav.classList.remove('open'); menuButton.setAttribute('aria-expanded', 'false'); }));
  const ratingButtons = $$('.star-picker button');
  ratingButtons.forEach(button => button.addEventListener('click', () => { selectedRating = Number(button.dataset.rating); $('input[name="rating"]', reviewForm).value = String(selectedRating); ratingButtons.forEach(b => { b.classList.toggle('selected', Number(b.dataset.rating) <= selectedRating); b.setAttribute('aria-checked', String(Number(b.dataset.rating) === selectedRating)); }); }));
  function setMessage(selector, message, error = false) { const el = $(selector); el.textContent = message; el.classList.toggle('error', error); }
  async function postForm(url, form, messageSelector) {
    const submit = $('button[type="submit"]', form); const original = submit.innerHTML; submit.disabled = true; submit.textContent = 'Отправляем…';
    setMessage(messageSelector, '');
    try {
      const data = Object.fromEntries(new FormData(form).entries());
      if (data.website) throw new Error('Не удалось отправить форму.');
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Не удалось отправить. Попробуйте ещё раз.');
      setMessage(messageSelector, result.message || 'Готово!'); form.reset();
      if (form === reviewForm) { selectedRating = 5; ratingButtons.forEach(b => b.classList.toggle('selected', Number(b.dataset.rating) <= 5)); $('input[name="rating"]', reviewForm).value = '5'; }
      if (form === bookingForm) { showToast(result.message || 'Заявка отправлена'); setTimeout(() => closeDialog(bookingDialog), 1400); }
    } catch (error) {
      const msg = error instanceof TypeError ? 'Сервер пока недоступен. Запустите сайт через npm start или позвоните нам: +7 (925) 100-90-90.' : error.message;
      setMessage(messageSelector, msg, true);
    } finally { submit.disabled = false; submit.innerHTML = original; }
  }
  reviewForm.addEventListener('submit', e => { e.preventDefault(); if (reviewForm.reportValidity()) postForm('/api/reviews', reviewForm, '#review-message'); });
  bookingForm.addEventListener('submit', e => { e.preventDefault(); if (bookingForm.reportValidity()) postForm('/api/bookings', bookingForm, '#booking-message'); });
  $$('[data-gallery]').forEach(el => el.addEventListener('click', () => openGallery(Number(el.dataset.gallery))));
  function openGallery(index) { galleryIndex = index; renderGallery(); if (galleryDialog.showModal) galleryDialog.showModal(); else galleryDialog.setAttribute('open', ''); document.body.classList.add('modal-open'); }
  function renderGallery() { const item = gallery[galleryIndex]; $('#gallery-modal-image').src = item.src; $('#gallery-modal-image').alt = item.alt; $('#gallery-modal-caption').textContent = item.caption; }
  $('.gallery-prev').addEventListener('click', () => { galleryIndex = (galleryIndex + gallery.length - 1) % gallery.length; renderGallery(); });
  $('.gallery-next').addEventListener('click', () => { galleryIndex = (galleryIndex + 1) % gallery.length; renderGallery(); });
  $('[data-close-gallery]').addEventListener('click', () => closeDialog(galleryDialog));
  galleryDialog.addEventListener('click', e => { if (e.target === galleryDialog) closeDialog(galleryDialog); });
  galleryDialog.addEventListener('close', () => { if (!bookingDialog.open) document.body.classList.remove('modal-open'); });
  document.addEventListener('keydown', e => { if (galleryDialog.open && e.key === 'ArrowRight') { galleryIndex = (galleryIndex + 1) % gallery.length; renderGallery(); } if (galleryDialog.open && e.key === 'ArrowLeft') { galleryIndex = (galleryIndex + gallery.length - 1) % gallery.length; renderGallery(); } });
  $('#year').textContent = new Date().getFullYear();
  const dateInput = $('input[name="date"]', bookingForm); dateInput.min = new Date().toISOString().slice(0, 10);
})();
