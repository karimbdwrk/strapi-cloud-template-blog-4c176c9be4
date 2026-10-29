'use strict';

/**
 * Abonnement des praticiens (pas de routes CRUD, voir src/billing.js) :
 * - GET  /billing/mine, POST /billing/checkout | /billing/portal | /billing/sync : le praticien connecté ;
 * - POST /billing/webhook : Stripe (signature vérifiée, pas de compte) ;
 * - GET  /billing/doctors/:documentId, POST /billing/doctors/:documentId/offer,
 *   POST /billing/offer-all : SuperAdmin (contrôlé dans le contrôleur).
 */

module.exports = {
	routes: [
		{ method: 'GET', path: '/billing/mine', handler: 'billing.mine' },
		{ method: 'POST', path: '/billing/checkout', handler: 'billing.checkout' },
		{ method: 'POST', path: '/billing/portal', handler: 'billing.portal' },
		{ method: 'POST', path: '/billing/sync', handler: 'billing.sync' },
		{ method: 'POST', path: '/billing/webhook', handler: 'billing.webhook', config: { auth: false } },
		{ method: 'GET', path: '/billing/doctors/:documentId', handler: 'billing.doctor' },
		{ method: 'POST', path: '/billing/doctors/:documentId/offer', handler: 'billing.offer' },
		{ method: 'POST', path: '/billing/offer-all', handler: 'billing.offerAll' },
	],
};
