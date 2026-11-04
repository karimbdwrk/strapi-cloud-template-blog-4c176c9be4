'use strict';

// Gestion des métiers depuis l'admin Meyana (chargé avant le routeur principal : /categories/admin ≠ /categories/:id).
// Permission du rôle SuperAdmin accordée au démarrage (src/index.js), le contrôleur revérifie le rôle.
module.exports = {
	routes: [
		{ method: 'GET', path: '/categories/admin', handler: 'category.adminList' },
		{ method: 'POST', path: '/categories/admin', handler: 'category.adminCreate' },
		{ method: 'PUT', path: '/categories/admin/:id', handler: 'category.adminUpdate' },
		{ method: 'DELETE', path: '/categories/admin/:id', handler: 'category.adminDelete' },
	],
};
