'use strict';

/**
 * Notifications liées aux avis et aux signalements.
 *   - nouvel avis           → praticien : review_received
 *   - nouveau signalement   → admins    : admin_report
 */

const { fullName, formatShortDate, notifier } = require('./helpers');

const RATING_UID = 'api::rating.rating';
const REPORT_UID = 'api::reporting.reporting';

const onRating = async (strapi, created) => {
	const rating = await strapi.documents(RATING_UID).findOne({
		documentId: created.documentId,
		fields: ['finalScore'],
		populate: {
			doctor: { fields: ['UUID'], populate: { users_permissions_user: { fields: ['id'] } } },
			appointment: { fields: ['datetime'] },
		},
	});
	if (!rating?.doctor) return;

	const score = Number(rating.finalScore || 0).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
	await notifier(strapi).notify({
		recipient: rating.doctor.users_permissions_user?.id,
		type: 'review_received',
		title: `Nouvel avis : ${score}/5`,
		body: rating.appointment?.datetime ? `Rendez-vous du ${formatShortDate(rating.appointment.datetime)}` : null,
		link: rating.doctor.UUID ? `/doctor/${rating.doctor.UUID}` : '/dashboard',
		dedupeKey: `review_received:${rating.documentId}`,
	});
};

const onReport = async (strapi, created) => {
	const report = await strapi.documents(REPORT_UID).findOne({
		documentId: created.documentId,
		fields: ['from'],
		populate: { doctor: { fields: ['firstname', 'lastname'] } },
	});
	if (!report) return;

	await notifier(strapi).notifyAdmins({
		type: 'admin_report',
		title: `Nouveau signalement ${report.from === 'doctor' ? 'd’un praticien' : 'd’un patient'}`,
		body: report.doctor ? `Concerne ${fullName(report.doctor)}` : null,
		link: '/admin/moderation?onglet=signalements',
		dedupeKey: `admin_report:${report.documentId}`,
	});
};

module.exports = {
	uids: [RATING_UID, REPORT_UID],

	async handle(strapi, context, result) {
		if (context.action !== 'create' || !result?.documentId) return;
		if (context.uid === RATING_UID) return onRating(strapi, result);
		if (context.uid === REPORT_UID) return onReport(strapi, result);
	},
};
