'use strict';

const { purge } = require('../src/audience');
const { expireOffers } = require('../src/billing');

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
};
