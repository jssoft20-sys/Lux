/* Сброс пароля администратора: node scripts/reset-admin.js [логин] [пароль] */
import { store } from '../src/store.js';
import { setAdminCredentials } from '../src/auth.js';

const login = process.argv[2] || (store.data.auth && store.data.auth.login) || 'admin';
const password = process.argv[3] || 'luxar2026';
setAdminCredentials(login, password);
console.log(`Готово. Логин: ${login}, пароль: ${password}`);
