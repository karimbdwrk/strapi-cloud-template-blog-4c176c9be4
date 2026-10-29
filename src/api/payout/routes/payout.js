'use strict';

/**
 * Paiements des consultations, côté praticien connecté (voir src/payments.js) :
 * - GET  /payouts/mine : compte de paiement et consultations payées en ligne ;
 * - POST /payouts/onboarding { returnPath } : lien vers le formulaire Stripe (identité, IBAN) ;
 * - POST /payouts/dashboard : lien vers son tableau de bord Stripe (paiements, virements).
 */

module.exports = {
	routes: [
		{ method: 'GET', path: '/payouts/mine', handler: 'payout.mine' },
		{ method: 'POST', path: '/payouts/onboarding', handler: 'payout.onboarding' },
		{ method: 'POST', path: '/payouts/dashboard', handler: 'payout.dashboard' },
	],
};
