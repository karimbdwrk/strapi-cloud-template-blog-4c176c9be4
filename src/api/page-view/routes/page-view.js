'use strict';

/**
 * Audience (pas de routes CRUD) :
 * - POST /page-views/track : public, une page vue envoyée par le site (connexion facultative) ;
 * - GET  /page-views/mine : le praticien connecté, audience de sa fiche ;
 * - GET  /page-views/site et /page-views/doctors : SuperAdmin (contrôlé dans le contrôleur).
 */

module.exports = {
	routes: [
		{ method: 'POST', path: '/page-views/track', handler: 'page-view.track', config: { auth: false } },
		{ method: 'GET', path: '/page-views/mine', handler: 'page-view.mine' },
		{ method: 'GET', path: '/page-views/site', handler: 'page-view.site' },
		{ method: 'GET', path: '/page-views/doctors', handler: 'page-view.doctors' },
	],
};
