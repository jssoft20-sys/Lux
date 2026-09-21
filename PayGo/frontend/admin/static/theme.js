/* Applies the saved theme before the first paint (the CSP forbids inline scripts). */
try { if (localStorage.getItem('paygo_theme') === 'dark') document.documentElement.setAttribute('data-theme', 'dark'); } catch (e) { /* private mode */ }
