'use strict';

/**
 * Données du compte connecté (pas de routes CRUD, voir src/account.js) :
 * - GET  /account/export : toutes ses données (JSON) ;
 * - POST /account/delete { password, reason? } : suppression (patient) ou demande de suppression (praticien).
 */

module.exports = {
	routes: [
		{ method: 'GET', path: '/account/export', handler: 'account.export' },
		{ method: 'POST', path: '/account/delete', handler: 'account.remove' },
	],
};
