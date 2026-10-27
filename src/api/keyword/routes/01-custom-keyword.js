'use strict';

// Mots-clés du praticien connecté et modération (chargés avant le routeur principal : /keywords/mine ≠ /keywords/:id)
module.exports = {
	routes: [
		{ method: 'GET', path: '/keywords/mine', handler: 'keyword.mine' },
		{ method: 'PUT', path: '/keywords/mine', handler: 'keyword.setMine' },
		{ method: 'DELETE', path: '/keywords/mine/:id', handler: 'keyword.withdraw' },
		// Modération (admin) : propositions et liste Meyana, champs internes compris
		{ method: 'GET', path: '/keywords/moderation', handler: 'keyword.moderation' },
		{ method: 'PUT', path: '/keywords/:id/moderate', handler: 'keyword.moderate' },
	],
};
