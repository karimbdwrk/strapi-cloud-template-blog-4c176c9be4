'use strict';

/**
 * Routes complémentaires des rendez-vous.
 * Le préfixe « 01- » les charge avant le routeur principal (sinon
 * « to-rate-count » serait pris pour un :id).
 */

module.exports = {
	routes: [
		{
			method: 'GET',
			path: '/appointments/to-rate-count',
			handler: 'appointment.toRateCount',
		},
		{
			// Créneaux pris d'un praticien (horaires uniquement) : public, pour les disponibilités
			method: 'GET',
			path: '/appointments/busy',
			handler: 'appointment.busy',
			config: { auth: false },
		},
		{
			// Paiement de la consultation : vérifié chez Stripe après le formulaire de carte
			method: 'POST',
			path: '/appointments/:id/confirm-payment',
			handler: 'appointment.confirmPayment',
		},
		{
			// Paiement fermé sans payer : le créneau est libéré
			method: 'POST',
			path: '/appointments/:id/abandon',
			handler: 'appointment.abandonPayment',
		},
	],
};
