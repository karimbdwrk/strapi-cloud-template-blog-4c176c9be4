'use strict';

const { purge } = require('../src/audience');
const { expireOffers } = require('../src/billing');
const { expirePending, mondayPayouts } = require('../src/payments');

/** Tâches planifiées (heure de Paris) */
module.exports = {
	// Mesure d'audience : visites de plus de 13 mois supprimées chaque nuit
	purgeOldPageViews: {
		task: ({ strapi }) => purge(strapi),
		options: { rule: '30 4 * * *', tz: 'Europe/Paris' },
	},
	// Abonnements : les mois offerts arrivés à terme repassent en Essentiel
	expireOfferedMonths: {
		task: ({ strapi }) => expireOffers(strapi),
		options: { rule: '15 0 * * *', tz: 'Europe/Paris' },
	},
	// Consultations : réservations non payées à temps, créneau libéré
	expireUnpaidAppointments: {
		task: ({ strapi }) => expirePending(strapi),
		options: { rule: '*/5 * * * *', tz: 'Europe/Paris' },
	},
	// Consultations : virement des consultations passées et récapitulatif aux praticiens
	mondayPayouts: {
		task: ({ strapi }) => mondayPayouts(strapi),
		options: { rule: '0 8 * * 1', tz: 'Europe/Paris' },
	},
};
