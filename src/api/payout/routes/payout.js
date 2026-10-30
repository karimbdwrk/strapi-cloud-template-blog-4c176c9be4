'use strict';

/**
 * Paiements des consultations, côté praticien connecté (voir src/payments.js) :
 * - GET  /payouts/mine : compte de paiement et consultations payées en ligne ;
 * - POST /payouts/onboarding { returnPath } : lien vers le formulaire Stripe (identité, IBAN) ;
 * - POST /payouts/dashboard : lien vers son tableau de bord Stripe (coordonnées bancaires) ;
 * - GET  /payouts/invoices : ses factures (abonnement, commission, consultations émises) ;
 * - PUT  /payouts/billing-info { data } : SIRET, régime de TVA, adresse de facturation.
 */

module.exports = {
	routes: [
		{ method: 'GET', path: '/payouts/mine', handler: 'payout.mine' },
		{ method: 'POST', path: '/payouts/onboarding', handler: 'payout.onboarding' },
		{ method: 'POST', path: '/payouts/dashboard', handler: 'payout.dashboard' },
		{ method: 'GET', path: '/payouts/invoices', handler: 'payout.invoices' },
		{ method: 'PUT', path: '/payouts/billing-info', handler: 'payout.billingInfo' },
	],
};
