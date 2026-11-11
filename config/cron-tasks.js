'use strict';

const { purge } = require('../src/audience');
const { expireOffers } = require('../src/billing');
const { expirePending, mondayPayouts } = require('../src/payments');
const { issueMissingInvoices } = require('../src/invoices');
const { sendPatientReminders, sendCloseReminders } = require('../src/appointment-reminders');
const { checkPaymentAccounts } = require('../src/payment-alerts');

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
	// Consultations : factures et avoirs restés en attente
	issueMissingInvoices: {
		task: ({ strapi }) => issueMissingInvoices(strapi),
		options: { rule: '2-59/10 * * * *', tz: 'Europe/Paris' },
	},
	// Rendez-vous : rappel au patient environ 24 heures avant (vérifié toutes les heures)
	appointmentReminders: {
		task: ({ strapi }) => sendPatientReminders(strapi),
		options: { rule: '20 * * * *', tz: 'Europe/Paris' },
	},
	// Rendez-vous : consultations passées à clôturer (le dimanche, relance avant le virement du lundi)
	closeReminders: {
		task: ({ strapi }) => sendCloseReminders(strapi),
		options: { rule: '0 19 * * *', tz: 'Europe/Paris' },
	},
	// Comptes de paiement des praticiens : informations à compléter, blocages (filet des webhooks)
	checkPaymentAccounts: {
		task: ({ strapi }) => checkPaymentAccounts(strapi),
		options: { rule: '0 7 * * *', tz: 'Europe/Paris' },
	},
	// Consultations : virement des consultations clôturées et récapitulatif aux praticiens
	mondayPayouts: {
		task: ({ strapi }) => mondayPayouts(strapi),
		options: { rule: '0 8 * * 1', tz: 'Europe/Paris' },
	},
};
