'use strict';

// Gestion des familles de métiers depuis l'admin Meyana (chargé avant le routeur principal : /profession-families/admin ≠ /profession-families/:id).
// Permission du rôle SuperAdmin accordée au démarrage (src/index.js), le contrôleur revérifie le rôle.
module.exports = {
	routes: [
		{ method: 'GET', path: '/profession-families/admin', handler: 'profession-family.adminList' },
		{ method: 'POST', path: '/profession-families/admin', handler: 'profession-family.adminCreate' },
		{ method: 'PUT', path: '/profession-families/admin/:id', handler: 'profession-family.adminUpdate' },
		{ method: 'DELETE', path: '/profession-families/admin/:id', handler: 'profession-family.adminDelete' },
	],
};
