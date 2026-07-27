(() => {
  'use strict';

  const APP_VERSION = 1;
  const DRAFT_KEY = 'ssi_invoice_pro_draft_v1';
  const HISTORY_KEY = 'ssi_invoice_pro_history_v1';
  const THEME_KEY = 'ssi_invoice_pro_theme_v1';
  const MAX_HISTORY = 25;
  const MIN_ROWS = 3;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const elements = {
    body: document.body,
    itemsBody: $('#itemsBody'),
    saveIndicator: $('#saveIndicator'),
    statusDot: $('#statusDot'),
    statusText: $('#statusText'),
    toast: $('#toast'),
    toastMessage: $('#toastMessage'),
    toastAction: $('#toastAction'),
    moreMenu: $('#moreMenu'),
    moreButton: $('#moreButton'),
    historyModal: $('#historyModal'),
    historyList: $('#historyList'),
    confirmModal: $('#confirmModal'),
    confirmTitle: $('#confirmTitle'),
    confirmMessage: $('#confirmMessage'),
    confirmAccept: $('#confirmAcceptButton'),
    confirmCancel: $('#confirmCancelButton'),
    importFileInput: $('#importFileInput'),
    printSheet: $('#printSheet'),
    installButton: $('#installButton')
  };

  const defaultInfo = () => ({
    companyName: 'Sri Sawdamman Infra',
    companyTag: 'Paver Block & Civil Works',
    companyAddress: '7/115, Kendaigoundanur,\nSullerumbu, Kendaigoundanur,\nDindigul, Tamil Nadu - 624710',
    gstin: '33QNWPS9493A1ZW',
    phone: '7904689983 / 6369477188',
    email: '',
    state: 'Tamil Nadu, Code: 33',
    invoiceNo: '',
    invoiceDate: isoToday(),
    orderNo: '',
    orderDate: '',
    buyer: '',
    consignee: '',
    taxMode: 'intra',
    gstRate: '18',
    discountRate: '0',
    otherCharges: '0',
    roundOffEnabled: true,
    bankName: '',
    accountNo: '',
    accountName: 'Sri Sawdamman Infra',
    ifsc: '',
    branch: '',
    upi: '',
    declaration: 'We declare that this invoice shows the actual price of the goods and services described and that all particulars are true and correct.',
    jurisdiction: 'Subject to Dindigul Jurisdiction'
  });

  const emptyItem = () => ({
    id: makeId(),
    description: '',
    hsn: '',
    qty: '',
    unit: 'Nos',
    rate: ''
  });

  let state = {
    version: APP_VERSION,
    info: defaultInfo(),
    items: Array.from({ length: MIN_ROWS }, emptyItem),
    updatedAt: Date.now()
  };

  let totals = calculateTotals(state);
  let toastTimer = 0;
  let saveTimer = 0;
  let lastDeleted = null;
  let confirmResolver = null;
  let deferredInstallPrompt = null;

  function makeId() {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
    return `row-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function isoToday() {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function displayDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return '';
    const [year, month, day] = value.split('-');
    return `${day}-${month}-${year}`;
  }

  function safeNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  }

  function roundMoney(value) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  const currencyFormatter = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  const numberFormatter = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  function formatCurrency(value) {
    return currencyFormatter.format(Number(value) || 0).replace('₹', '₹');
  }

  function formatPlain(value) {
    return numberFormatter.format(Number(value) || 0);
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
  }

  function firstLine(value) {
    return String(value || '').split(/\r?\n/)[0].trim();
  }

  function calculateTotals(currentState) {
    const subtotal = currentState.items.reduce((sum, item) => sum + safeNumber(item.qty) * safeNumber(item.rate), 0);
    const discountRate = Math.min(100, safeNumber(currentState.info.discountRate));
    const discount = subtotal * discountRate / 100;
    const otherCharges = safeNumber(currentState.info.otherCharges);
    const taxable = Math.max(0, subtotal - discount + otherCharges);
    const gstRate = currentState.info.taxMode === 'none' ? 0 : safeNumber(currentState.info.gstRate);
    const taxTotal = taxable * gstRate / 100;
    const cgst = currentState.info.taxMode === 'intra' ? taxTotal / 2 : 0;
    const sgst = currentState.info.taxMode === 'intra' ? taxTotal / 2 : 0;
    const igst = currentState.info.taxMode === 'inter' ? taxTotal : 0;
    const beforeRound = taxable + cgst + sgst + igst;
    const roundOff = currentState.info.roundOffEnabled ? Math.round(beforeRound) - beforeRound : 0;
    const net = beforeRound + roundOff;

    return {
      subtotal: roundMoney(subtotal),
      discount: roundMoney(discount),
      otherCharges: roundMoney(otherCharges),
      taxable: roundMoney(taxable),
      cgst: roundMoney(cgst),
      sgst: roundMoney(sgst),
      igst: roundMoney(igst),
      roundOff: roundMoney(roundOff),
      net: roundMoney(net)
    };
  }

  function setStatus(message, mode = '') {
    elements.statusText.textContent = message;
    elements.statusDot.className = `status-dot${mode ? ` ${mode}` : ''}`;
  }

  function showToast(message, { actionText = '', onAction = null, duration = 2800 } = {}) {
    clearTimeout(toastTimer);
    elements.toastMessage.textContent = message;
    if (actionText && typeof onAction === 'function') {
      elements.toastAction.textContent = actionText;
      elements.toastAction.hidden = false;
      elements.toastAction.onclick = () => {
        onAction();
        hideToast();
      };
    } else {
      elements.toastAction.hidden = true;
      elements.toastAction.onclick = null;
    }
    elements.toast.classList.add('show');
    toastTimer = window.setTimeout(hideToast, duration);
  }

  function hideToast() {
    elements.toast.classList.remove('show');
  }

  function scheduleSave() {
    setStatus('Saving…', 'saving');
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(saveDraft, 360);
  }

  function saveDraft() {
    try {
      state.updatedAt = Date.now();
      localStorage.setItem(DRAFT_KEY, JSON.stringify(state));
      setStatus(navigator.onLine ? 'Saved' : 'Saved offline', navigator.onLine ? 'saved' : 'offline');
    } catch (error) {
      console.error(error);
      setStatus('Save failed');
      showToast('The browser could not save this draft.');
    }
  }

  function normalizeState(input) {
    const info = { ...defaultInfo(), ...(input?.info || {}) };
    info.roundOffEnabled = Boolean(info.roundOffEnabled);
    const items = Array.isArray(input?.items)
      ? input.items.map(item => ({ ...emptyItem(), ...item, id: item.id || makeId() }))
      : [];
    while (items.length < MIN_ROWS) items.push(emptyItem());
    return { version: APP_VERSION, info, items, updatedAt: Number(input?.updatedAt) || Date.now() };
  }

  function loadDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return false;
      state = normalizeState(JSON.parse(raw));
      return true;
    } catch (error) {
      console.warn('Draft restore failed:', error);
      return false;
    }
  }

  function readHistory() {
    try {
      const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      return Array.isArray(history) ? history : [];
    } catch {
      return [];
    }
  }

  function writeHistory(history) {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
  }

  function renderAll() {
    writeFormFromState();
    renderItems();
    refreshTotals();
    updateConnectionStatus();
  }

  function writeFormFromState() {
    $$('[data-field]').forEach(control => {
      const key = control.dataset.field;
      if (!(key in state.info)) return;
      if (control.type === 'checkbox') control.checked = Boolean(state.info[key]);
      else control.value = state.info[key] ?? '';
    });
    validateGstin();
  }

  function readControlValue(control) {
    return control.type === 'checkbox' ? control.checked : control.value;
  }

  function updateStateFromControl(control) {
    const key = control.dataset.field;
    if (!key) return;
    state.info[key] = readControlValue(control);
    if (key === 'gstin') validateGstin();
    refreshTotals();
    scheduleSave();
  }

  function validateGstin() {
    const input = $('#gstinInput');
    const value = input.value.trim().toUpperCase();
    if (input.value !== value) input.value = value;
    state.info.gstin = value;
    const valid = !value || /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(value);
    input.setAttribute('aria-invalid', String(!valid));
    input.setCustomValidity(valid ? '' : 'Enter a valid 15-character GSTIN.');
    return valid;
  }

  function renderItems() {
    elements.itemsBody.innerHTML = state.items.map((item, index) => `
      <tr data-row-id="${escapeHtml(item.id)}">
        <td class="serial-cell" data-label="S.No.">${index + 1}</td>
        <td data-label="Description">
          <input class="item-input" data-item-field="description" value="${escapeHtml(item.description)}" placeholder="Material or service" aria-label="Item ${index + 1} description">
        </td>
        <td data-label="HSN/SAC">
          <input class="item-input" data-item-field="hsn" value="${escapeHtml(item.hsn)}" placeholder="HSN/SAC" inputmode="numeric" aria-label="Item ${index + 1} HSN or SAC">
        </td>
        <td data-label="Quantity">
          <input class="item-input" data-item-field="qty" value="${escapeHtml(item.qty)}" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0" aria-label="Item ${index + 1} quantity">
        </td>
        <td data-label="Unit">
          <input class="item-input" data-item-field="unit" value="${escapeHtml(item.unit)}" list="unitOptions" placeholder="Nos" aria-label="Item ${index + 1} unit">
        </td>
        <td data-label="Rate">
          <input class="item-input" data-item-field="rate" value="${escapeHtml(item.rate)}" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00" aria-label="Item ${index + 1} rate">
        </td>
        <td class="amount-cell" data-label="Amount">${formatCurrency(safeNumber(item.qty) * safeNumber(item.rate))}</td>
        <td class="delete-cell" data-label="Action">
          <button class="delete-item-button" type="button" data-delete-row="${escapeHtml(item.id)}" aria-label="Delete item ${index + 1}">×</button>
        </td>
      </tr>
    `).join('');
  }

  function addItem({ focus = true, item = null, index = state.items.length } = {}) {
    state.items.splice(index, 0, item ? { ...emptyItem(), ...item, id: item.id || makeId() } : emptyItem());
    renderItems();
    refreshTotals();
    scheduleSave();
    if (focus) {
      requestAnimationFrame(() => {
        const row = elements.itemsBody.querySelector(`tr[data-row-id="${CSS.escape(state.items[index].id)}"]`);
        row?.querySelector('[data-item-field="description"]')?.focus();
        row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }
  }

  function deleteItem(id) {
    const index = state.items.findIndex(item => item.id === id);
    if (index < 0) return;
    const [item] = state.items.splice(index, 1);
    lastDeleted = { item, index };
    if (!state.items.length) state.items.push(emptyItem());
    renderItems();
    refreshTotals();
    scheduleSave();
    showToast('Item deleted.', {
      actionText: 'Undo',
      onAction: () => {
        if (!lastDeleted) return;
        addItem({ focus: false, item: lastDeleted.item, index: Math.min(lastDeleted.index, state.items.length) });
        lastDeleted = null;
        showToast('Item restored.');
      },
      duration: 5000
    });
  }

  function updateItemFromInput(input) {
    const row = input.closest('tr[data-row-id]');
    if (!row) return;
    const item = state.items.find(entry => entry.id === row.dataset.rowId);
    if (!item) return;
    item[input.dataset.itemField] = input.value;
    const amountCell = $('.amount-cell', row);
    amountCell.textContent = formatCurrency(safeNumber(item.qty) * safeNumber(item.rate));
    refreshTotals();
    scheduleSave();
  }

  function refreshTotals() {
    totals = calculateTotals(state);
    const info = state.info;
    const gstRate = safeNumber(info.gstRate);
    const halfRate = gstRate / 2;
    const nonEmptyItems = state.items.filter(item => item.description || safeNumber(item.qty) || safeNumber(item.rate));

    $('#metricInvoice').textContent = info.invoiceNo.trim() || 'Not numbered';
    $('#metricItems').textContent = String(nonEmptyItems.length);
    $('#metricTotal').textContent = formatCurrency(totals.net);
    $('#subtotalValue').textContent = formatCurrency(totals.subtotal);
    $('#discountValue').textContent = `− ${formatCurrency(totals.discount)}`;
    $('#otherChargesValue').textContent = formatCurrency(totals.otherCharges);
    $('#taxableValue').textContent = formatCurrency(totals.taxable);
    $('#cgstValue').textContent = formatCurrency(totals.cgst);
    $('#sgstValue').textContent = formatCurrency(totals.sgst);
    $('#igstValue').textContent = formatCurrency(totals.igst);
    $('#roundOffValue').textContent = `${totals.roundOff >= 0 ? '+' : '−'} ${formatCurrency(Math.abs(totals.roundOff))}`;
    $('#netTotalValue').textContent = formatCurrency(totals.net);
    $('#amountWords').textContent = amountInWords(totals.net);
    $('#signatureCompany').textContent = `For ${info.companyName || 'Sri Sawdamman Infra'}`;

    $('#cgstRateLabel').textContent = `${trimNumber(halfRate)}%`;
    $('#sgstRateLabel').textContent = `${trimNumber(halfRate)}%`;
    $('#igstRateLabel').textContent = `${trimNumber(gstRate)}%`;

    const isIntra = info.taxMode === 'intra';
    const isInter = info.taxMode === 'inter';
    $('#cgstRow').hidden = !isIntra;
    $('#sgstRow').hidden = !isIntra;
    $('#igstRow').hidden = !isInter;
    $('#gstRateSelect').disabled = info.taxMode === 'none';
    $('#invoiceTypeBadge').textContent = isIntra ? 'Intra-state GST' : isInter ? 'Inter-state GST' : 'GST not applied';
  }

  function trimNumber(value) {
    return Number.isInteger(value) ? String(value) : String(roundMoney(value));
  }

  function numberToIndianWords(integer) {
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

    const belowHundred = number => {
      if (number < 20) return ones[number];
      return `${tens[Math.floor(number / 10)]}${number % 10 ? ` ${ones[number % 10]}` : ''}`;
    };

    const belowThousand = number => {
      const hundred = Math.floor(number / 100);
      const remainder = number % 100;
      return `${hundred ? `${ones[hundred]} Hundred` : ''}${hundred && remainder ? ' ' : ''}${remainder ? belowHundred(remainder) : ''}`;
    };

    if (integer === 0) return 'Zero';
    if (integer > 999999999) return integer.toLocaleString('en-IN');

    const groups = [
      [10000000, 'Crore'],
      [100000, 'Lakh'],
      [1000, 'Thousand']
    ];
    let remaining = integer;
    const words = [];

    groups.forEach(([value, label]) => {
      const count = Math.floor(remaining / value);
      if (count) {
        words.push(`${belowThousand(count)} ${label}`);
        remaining %= value;
      }
    });
    if (remaining) words.push(belowThousand(remaining));
    return words.join(' ');
  }

  function amountInWords(value) {
    const absolute = Math.abs(Number(value) || 0);
    const rupees = Math.floor(absolute);
    const paise = Math.round((absolute - rupees) * 100);
    return `Rupees ${numberToIndianWords(rupees)}${paise ? ` and ${numberToIndianWords(paise)} Paise` : ''} Only`;
  }

  function generateInvoiceNumber() {
    const date = new Date();
    const sequence = String(readHistory().length + 1).padStart(3, '0');
    const value = `SSI-${date.getFullYear()}-${sequence}`;
    state.info.invoiceNo = value;
    $('#invoiceNoInput').value = value;
    refreshTotals();
    scheduleSave();
    showToast(`Invoice number ${value} created.`);
  }

  function validateBeforeFinalAction() {
    const missing = [];
    if (!state.info.companyName.trim()) missing.push('company name');
    if (!state.info.invoiceNo.trim()) missing.push('invoice number');
    if (!state.info.invoiceDate) missing.push('invoice date');
    if (!state.info.buyer.trim()) missing.push('buyer details');
    if (!state.items.some(item => item.description.trim() && safeNumber(item.qty) > 0 && safeNumber(item.rate) >= 0)) missing.push('at least one complete item');
    if (!validateGstin()) missing.push('valid GSTIN');
    if (missing.length) {
      showToast(`Check: ${missing.join(', ')}.`, { duration: 4300 });
      return false;
    }
    return true;
  }

  function snapshot() {
    return JSON.parse(JSON.stringify({ ...state, totals, savedAt: Date.now() }));
  }

  function saveInvoiceToHistory() {
    if (!validateBeforeFinalAction()) return;
    const history = readHistory();
    const current = snapshot();
    const key = current.info.invoiceNo.trim().toLowerCase();
    const existingIndex = history.findIndex(entry => String(entry.info?.invoiceNo || '').trim().toLowerCase() === key);
    if (existingIndex >= 0) history.splice(existingIndex, 1);
    history.unshift(current);
    writeHistory(history);
    saveDraft();
    showToast('Invoice saved to history.');
  }

  function renderHistory() {
    const history = readHistory();
    if (!history.length) {
      elements.historyList.innerHTML = '<div class="history-empty">No saved invoices yet. Use the Save button to keep a finished invoice here.</div>';
      return;
    }
    elements.historyList.innerHTML = history.map((entry, index) => {
      const entryTotals = calculateTotals(normalizeState(entry));
      const buyer = firstLine(entry.info?.buyer) || 'Buyer not entered';
      const date = displayDate(entry.info?.invoiceDate) || 'No date';
      return `
        <article class="history-entry">
          <div class="history-entry-main">
            <strong>${escapeHtml(entry.info?.invoiceNo || 'Unnumbered invoice')} · ${formatCurrency(entryTotals.net)}</strong>
            <span>${escapeHtml(buyer)} · ${escapeHtml(date)}</span>
          </div>
          <div class="history-entry-actions">
            <button type="button" data-history-open="${index}">Open</button>
            <button type="button" data-history-delete="${index}" class="danger-text">Delete</button>
          </div>
        </article>
      `;
    }).join('');
  }

  function openHistory() {
    renderHistory();
    openModal(elements.historyModal);
  }

  function loadHistoryEntry(index) {
    const history = readHistory();
    if (!history[index]) return;
    state = normalizeState(history[index]);
    renderAll();
    saveDraft();
    closeModal(elements.historyModal);
    showToast('Saved invoice opened.');
  }

  async function deleteHistoryEntry(index) {
    const accepted = await confirmAction('Delete saved invoice?', 'This removes the selected invoice from local history. Your current draft will not change.', 'Delete');
    if (!accepted) return;
    const history = readHistory();
    history.splice(index, 1);
    writeHistory(history);
    renderHistory();
    showToast('Saved invoice deleted.');
  }

  function downloadBlob(blob, filename) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  function exportBackup() {
    const payload = JSON.stringify({ app: 'Sri Sawdamman Invoice Pro', version: APP_VERSION, exportedAt: new Date().toISOString(), invoice: snapshot() }, null, 2);
    const filename = `${sanitizeFilename(state.info.invoiceNo || 'invoice-draft')}.json`;
    downloadBlob(new Blob([payload], { type: 'application/json' }), filename);
    closeMoreMenu();
    showToast('Backup downloaded.');
  }

  function sanitizeFilename(value) {
    return String(value).trim().replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'invoice';
  }

  async function importBackup(file) {
    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw);
      const candidate = parsed.invoice || parsed;
      if (!candidate?.info || !Array.isArray(candidate?.items)) throw new Error('Invalid invoice backup');
      const accepted = await confirmAction('Import this invoice?', 'The current draft will be replaced. It is already auto-saved in this browser.', 'Import');
      if (!accepted) return;
      state = normalizeState(candidate);
      renderAll();
      saveDraft();
      showToast('Invoice backup imported.');
    } catch (error) {
      console.error(error);
      showToast('That file is not a valid invoice backup.', { duration: 4200 });
    } finally {
      elements.importFileInput.value = '';
    }
  }

  function buildShareText() {
    return [
      `Tax Invoice ${state.info.invoiceNo || ''}`.trim(),
      state.info.companyName,
      `Date: ${displayDate(state.info.invoiceDate) || '-'}`,
      `Buyer: ${firstLine(state.info.buyer) || '-'}`,
      `Net Total: ${formatCurrency(totals.net)}`
    ].join('\n');
  }

  async function shareInvoice() {
    const text = buildShareText();
    const backup = JSON.stringify({ invoice: snapshot() }, null, 2);
    const filename = `${sanitizeFilename(state.info.invoiceNo || 'invoice')}.json`;
    try {
      if (navigator.share) {
        const file = new File([backup], filename, { type: 'application/json' });
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ title: state.info.invoiceNo || 'Tax Invoice', text, files: [file] });
        } else {
          await navigator.share({ title: state.info.invoiceNo || 'Tax Invoice', text });
        }
        showToast('Share completed.');
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        showToast('Invoice summary copied.');
      } else {
        exportBackup();
      }
    } catch (error) {
      if (error?.name !== 'AbortError') showToast('Share could not be completed.');
    }
  }

  function buildPrintSheet() {
    totals = calculateTotals(state);
    const info = state.info;
    const printableItems = state.items.filter(item => item.description || item.hsn || safeNumber(item.qty) || safeNumber(item.rate));
    const rows = (printableItems.length ? printableItems : [emptyItem()]).map((item, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(item.description)}</td>
        <td>${escapeHtml(item.hsn)}</td>
        <td>${escapeHtml(item.qty)}</td>
        <td>${escapeHtml(item.unit)}</td>
        <td>${item.rate === '' ? '' : formatPlain(item.rate)}</td>
        <td>${item.qty === '' || item.rate === '' ? '' : formatPlain(safeNumber(item.qty) * safeNumber(item.rate))}</td>
      </tr>
    `).join('');

    const bankFields = [
      ['Bank', info.bankName], ['A/C No.', info.accountNo], ['Name', info.accountName],
      ['IFSC', info.ifsc], ['Branch', info.branch], ['UPI', info.upi]
    ].filter(([, value]) => String(value || '').trim());

    const bankHtml = bankFields.length
      ? bankFields.map(([label, value]) => `<div><b>${escapeHtml(label)}:</b> ${escapeHtml(value)}</div>`).join('')
      : '<div>—</div>';

    const taxRows = [];
    if (totals.discount > 0) taxRows.push(printTotalRow('Discount', `${trimNumber(info.discountRate)}%`, `− ${formatPlain(totals.discount)}`));
    if (totals.otherCharges > 0) taxRows.push(printTotalRow('Other Charges', '', formatPlain(totals.otherCharges)));
    taxRows.push(printTotalRow('Total Taxable Value', '', formatPlain(totals.taxable)));
    if (info.taxMode === 'intra') {
      taxRows.push(printTotalRow('CGST', `${trimNumber(safeNumber(info.gstRate) / 2)}%`, formatPlain(totals.cgst)));
      taxRows.push(printTotalRow('SGST', `${trimNumber(safeNumber(info.gstRate) / 2)}%`, formatPlain(totals.sgst)));
    } else if (info.taxMode === 'inter') {
      taxRows.push(printTotalRow('IGST', `${trimNumber(safeNumber(info.gstRate))}%`, formatPlain(totals.igst)));
    }
    if (Math.abs(totals.roundOff) >= 0.005) taxRows.push(printTotalRow('Round Off', '', `${totals.roundOff >= 0 ? '+' : '−'} ${formatPlain(Math.abs(totals.roundOff))}`));
    taxRows.push(printTotalRow('NET TOTAL', '', formatPlain(totals.net), true));

    elements.printSheet.innerHTML = `
      <div class="print-page">
        <div class="print-title">TAX INVOICE<small>CASH / CREDIT BILL</small></div>
        <div class="print-grid-2">
          <div class="print-company">
            <h1>${escapeHtml(info.companyName)}</h1>
            <div class="tag">${escapeHtml(info.companyTag)}</div>
            <div class="address">${escapeHtml(info.companyAddress)}</div>
          </div>
          <div>
            <div class="print-tax-row"><b>GSTIN</b><span>${escapeHtml(info.gstin)}</span></div>
            <div class="print-tax-row"><b>Cell No.</b><span>${escapeHtml(info.phone)}</span></div>
            <div class="print-tax-row"><b>Email</b><span>${escapeHtml(info.email)}</span></div>
            <div class="print-tax-row"><b>State</b><span>${escapeHtml(info.state)}</span></div>
          </div>
        </div>
        <div class="print-meta">
          <div><b>Invoice No.: ${escapeHtml(info.invoiceNo)}</b>Date: ${escapeHtml(displayDate(info.invoiceDate))}</div>
          <div><b>Buyer's Order No.: ${escapeHtml(info.orderNo)}</b>Date: ${escapeHtml(displayDate(info.orderDate))}</div>
        </div>
        <div class="print-parties">
          <div><b>Buyer (Bill To)</b><div class="print-party-text">${escapeHtml(info.buyer)}</div></div>
          <div><b>Consignee / Ship To</b><div class="print-party-text">${escapeHtml(info.consignee)}</div></div>
        </div>
        <table class="print-items">
          <thead><tr><th style="width:6%">S.No.</th><th style="width:31%">Description of Goods</th><th style="width:12%">HSN/SAC</th><th style="width:10%">Quantity</th><th style="width:10%">Unit</th><th style="width:12%">Rate</th><th style="width:19%">Amount</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="print-lower">
          <div class="print-lower-left">
            <div class="print-box"><b>Amount Chargeable (in words)</b><div class="print-words">${escapeHtml(amountInWords(totals.net))}</div></div>
            <div class="print-box"><b>Bank Account Details</b><div class="print-bank">${bankHtml}</div></div>
            <div class="print-box"><b>Declaration</b>${escapeHtml(info.declaration)}</div>
          </div>
          <div>${taxRows.join('')}</div>
        </div>
        <div class="print-signatures">
          <div><span>Customer's Seal and Signature</span><b>Customer Signature</b></div>
          <div><span style="text-align:right">For ${escapeHtml(info.companyName)}</span><b>Authorised Signatory</b></div>
        </div>
        <div class="print-jurisdiction">${escapeHtml(info.jurisdiction)}</div>
      </div>
    `;
  }

  function printTotalRow(label, rate, value, net = false) {
    return `<div class="print-total-row${net ? ' net' : ''}"><div class="label">${escapeHtml(label)}</div><div class="rate">${escapeHtml(rate)}</div><div class="value">${escapeHtml(value)}</div></div>`;
  }

  function printInvoice(pdfHint = false) {
    validateBeforeFinalAction();
    buildPrintSheet();
    if (pdfHint) showToast('In the print window, choose “Save as PDF”.', { duration: 4500 });
    window.setTimeout(() => window.print(), 120);
  }

  function newInvoice() {
    const companyFields = {
      companyName: state.info.companyName,
      companyTag: state.info.companyTag,
      companyAddress: state.info.companyAddress,
      gstin: state.info.gstin,
      phone: state.info.phone,
      email: state.info.email,
      state: state.info.state,
      bankName: state.info.bankName,
      accountNo: state.info.accountNo,
      accountName: state.info.accountName,
      ifsc: state.info.ifsc,
      branch: state.info.branch,
      upi: state.info.upi,
      declaration: state.info.declaration,
      jurisdiction: state.info.jurisdiction,
      taxMode: state.info.taxMode,
      gstRate: state.info.gstRate
    };
    state = normalizeState({ info: { ...defaultInfo(), ...companyFields, invoiceDate: isoToday() }, items: Array.from({ length: MIN_ROWS }, emptyItem) });
    renderAll();
    saveDraft();
    showToast('New invoice ready. Company settings were kept.');
  }

  async function confirmNewInvoice() {
    const accepted = await confirmAction('Start a new invoice?', 'The current invoice remains in auto-saved draft until the new invoice replaces it. Save it to History first if needed.', 'New invoice');
    if (accepted) newInvoice();
  }

  async function clearInvoice() {
    closeMoreMenu();
    const accepted = await confirmAction('Clear this invoice?', 'All current invoice fields and items will be reset. Company information will also return to the default values.', 'Clear');
    if (!accepted) return;
    state = normalizeState({ info: defaultInfo(), items: Array.from({ length: MIN_ROWS }, emptyItem) });
    renderAll();
    saveDraft();
    showToast('Invoice cleared.');
  }

  function openModal(modal) {
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => $('.modal-close, button, input', modal)?.focus());
  }

  function closeModal(modal) {
    modal.hidden = true;
    if ($$('.modal-backdrop:not([hidden])').length === 0) document.body.style.overflow = '';
  }

  function confirmAction(title, message, acceptText = 'Continue') {
    elements.confirmTitle.textContent = title;
    elements.confirmMessage.textContent = message;
    elements.confirmAccept.textContent = acceptText;
    openModal(elements.confirmModal);
    return new Promise(resolve => { confirmResolver = resolve; });
  }

  function resolveConfirm(value) {
    closeModal(elements.confirmModal);
    if (confirmResolver) confirmResolver(value);
    confirmResolver = null;
  }

  function toggleMoreMenu() {
    const willOpen = elements.moreMenu.hidden;
    elements.moreMenu.hidden = !willOpen;
    elements.moreButton.setAttribute('aria-expanded', String(willOpen));
  }

  function closeMoreMenu() {
    elements.moreMenu.hidden = true;
    elements.moreButton.setAttribute('aria-expanded', 'false');
  }

  function applyTheme(theme) {
    const next = theme === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem(THEME_KEY, next);
    $('meta[name="theme-color"]')?.setAttribute('content', next === 'light' ? '#eaf3f8' : '#071523');
    $('#themeButton').setAttribute('aria-label', next === 'light' ? 'Switch to dark theme' : 'Switch to light theme');
  }

  function toggleTheme() {
    applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
  }

  function updateConnectionStatus() {
    if (navigator.onLine) {
      const stored = localStorage.getItem(DRAFT_KEY);
      setStatus(stored ? 'Saved' : 'Ready', stored ? 'saved' : '');
    } else {
      setStatus('Offline', 'offline');
    }
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    navigator.serviceWorker.register('./sw.js').catch(error => console.warn('Service worker registration failed:', error));
  }

  function bindEvents() {
    document.addEventListener('input', event => {
      const control = event.target.closest('[data-field]');
      if (control) updateStateFromControl(control);
      const itemInput = event.target.closest('[data-item-field]');
      if (itemInput) updateItemFromInput(itemInput);
    });

    document.addEventListener('change', event => {
      const control = event.target.closest('[data-field]');
      if (control) updateStateFromControl(control);
    });

    elements.itemsBody.addEventListener('click', event => {
      const deleteButton = event.target.closest('[data-delete-row]');
      if (deleteButton) deleteItem(deleteButton.dataset.deleteRow);
    });

    elements.itemsBody.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.shiftKey) return;
      const input = event.target.closest('[data-item-field]');
      if (!input) return;
      event.preventDefault();
      const inputs = $$('[data-item-field]', elements.itemsBody);
      const index = inputs.indexOf(input);
      if (index === inputs.length - 1) addItem();
      else inputs[index + 1]?.focus();
    });

    $('#addItemButton').addEventListener('click', () => addItem());
    $('#addItemTopButton').addEventListener('click', () => addItem());
    $('#saveInvoiceButton').addEventListener('click', saveInvoiceToHistory);
    $('#shareButton').addEventListener('click', shareInvoice);
    $('#pdfButton').addEventListener('click', () => printInvoice(true));
    $('#printButton').addEventListener('click', () => printInvoice(false));
    $('#historyButton').addEventListener('click', openHistory);
    $('#newInvoiceButton').addEventListener('click', confirmNewInvoice);
    $('#generateInvoiceButton').addEventListener('click', generateInvoiceNumber);
    $('#copyBuyerButton').addEventListener('click', () => {
      state.info.consignee = state.info.buyer;
      $('#consigneeInput').value = state.info.consignee;
      scheduleSave();
      showToast('Buyer details copied to consignee.');
    });
    $('#themeButton').addEventListener('click', toggleTheme);
    elements.moreButton.addEventListener('click', toggleMoreMenu);
    $('#exportButton').addEventListener('click', exportBackup);
    $('#importButton').addEventListener('click', () => {
      closeMoreMenu();
      elements.importFileInput.click();
    });
    $('#clearButton').addEventListener('click', clearInvoice);
    elements.importFileInput.addEventListener('change', event => {
      const file = event.target.files?.[0];
      if (file) importBackup(file);
    });

    elements.historyList.addEventListener('click', event => {
      const openButton = event.target.closest('[data-history-open]');
      const deleteButton = event.target.closest('[data-history-delete]');
      if (openButton) loadHistoryEntry(Number(openButton.dataset.historyOpen));
      if (deleteButton) deleteHistoryEntry(Number(deleteButton.dataset.historyDelete));
    });

    $$('[data-close-modal]').forEach(button => button.addEventListener('click', () => closeModal($(`#${button.dataset.closeModal}`))));
    $$('.modal-backdrop').forEach(backdrop => backdrop.addEventListener('mousedown', event => {
      if (event.target === backdrop) {
        if (backdrop === elements.confirmModal) resolveConfirm(false);
        else closeModal(backdrop);
      }
    }));
    elements.confirmCancel.addEventListener('click', () => resolveConfirm(false));
    elements.confirmAccept.addEventListener('click', () => resolveConfirm(true));

    document.addEventListener('click', event => {
      if (!event.target.closest('.action-dock')) closeMoreMenu();
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        closeMoreMenu();
        if (!elements.confirmModal.hidden) resolveConfirm(false);
        else if (!elements.historyModal.hidden) closeModal(elements.historyModal);
      }
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveInvoiceToHistory();
      }
      if (modifier && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        printInvoice(false);
      }
      if (event.altKey && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        addItem();
      }
    });

    window.addEventListener('online', updateConnectionStatus);
    window.addEventListener('offline', updateConnectionStatus);
    window.addEventListener('beforeprint', buildPrintSheet);

    window.addEventListener('beforeinstallprompt', event => {
      event.preventDefault();
      deferredInstallPrompt = event;
      elements.installButton.hidden = false;
    });
    elements.installButton.addEventListener('click', async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      elements.installButton.hidden = true;
    });
    window.addEventListener('appinstalled', () => {
      elements.installButton.hidden = true;
      showToast('Invoice Pro installed.');
    });
  }

  function init() {
    const storedTheme = localStorage.getItem(THEME_KEY);
    const preferredTheme = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    applyTheme(storedTheme || preferredTheme);
    loadDraft();
    bindEvents();
    renderAll();
    registerServiceWorker();
  }

  init();
})();