/* Нормализация телефонов. Храним только цифры с кодом страны: 996555123456 */

export function normalizePhone(input) {
  if (!input) return '';
  let d = String(input).replace(/\D+/g, '');
  if (!d) return '';
  if (d.length === 10 && d.startsWith('0')) d = '996' + d.slice(1); // 0555 123456
  else if (d.length === 9 && /^[2-9]/.test(d)) d = '996' + d; // 555123456
  else if (d.length === 11 && d.startsWith('8')) d = '7' + d.slice(1); // Россия 8xxx
  return d;
}

export function isValidPhone(digits) {
  return /^\d{10,15}$/.test(digits || '');
}

export function formatPhone(digits) {
  if (!digits) return '';
  const d = String(digits).replace(/\D+/g, '');
  if (d.startsWith('996') && d.length === 12) return `+996 ${d.slice(3, 6)} ${d.slice(6, 9)} ${d.slice(9, 12)}`;
  if (d.startsWith('7') && d.length === 11) return `+7 ${d.slice(1, 4)} ${d.slice(4, 7)} ${d.slice(7, 9)} ${d.slice(9, 11)}`;
  return '+' + d;
}

export function waLink(digits, text = '') {
  const d = String(digits || '').replace(/\D+/g, '');
  return `https://wa.me/${d}${text ? '?text=' + encodeURIComponent(text) : ''}`;
}
