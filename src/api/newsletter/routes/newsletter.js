'use strict';

/**
 * Newsletter (pas de routes CRUD : la liste des inscrits n'est jamais exposée) :
 * - POST /newsletter/subscribe   { email }  public ;
 * - POST /newsletter/unsubscribe { token } ou { email }, ou ?token= (désinscription en un clic
 *   des messageries, en-tête List-Unsubscribe) : public ;
 * - GET  /newsletter/export      SuperAdmin : inscrits actifs en CSV.
 */

module.exports = {
	routes: [
		{ method: 'POST', path: '/newsletter/subscribe', handler: 'newsletter.subscribe', config: { auth: false } },
		{ method: 'POST', path: '/newsletter/unsubscribe', handler: 'newsletter.unsubscribe', config: { auth: false } },
		{ method: 'GET', path: '/newsletter/export', handler: 'newsletter.export' },
	],
};
