'use strict';

/**
 * Notifications liées aux avis et aux signalements.
 *   - nouvel avis           → praticien : review_received (sans la note ni le rendez-vous)
 *   - nouveau signalement   → admins    : admin_report
 *   - statut du signalement → auteur    : report_update (pris en charge, traité, classé sans suite)
 */

const { fullName, formatShortDate, notifier } = require('./helpers');

const RATING_UID = 'api::rating.rating';
const REPORT_UID = 'api::reporting.reporting';

// Ni la note ni le rendez-vous : un avis n'est jamais rattachable à une consultation par le praticien
const onRating = async (strapi, created) => {
	const rating = await strapi.documents(RATING_UID).findOne({
		documentId: created.documentId,
		fields: ['id'],
		populate: { doctor: { fields: ['UUID'], populate: { users_permissions_user: { fields: ['id'] } } } },
	});
	if (!rating?.doctor) return;

	await notifier(strapi).notify({
		recipient: rating.doctor.users_permissions_user?.id,
		type: 'review_received',
		title: 'Vous avez reçu un nouvel avis',
		body: 'Votre note globale a été mise à jour.',
		link: '/dashboard',
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

// Message à l'auteur selon le nouveau statut (pas de notification quand un signalement est rouvert)
const REPORT_UPDATES = {
	in_progress: 'Votre signalement est pris en charge',
	resolved: 'Votre signalement a été traité',
	dismissed: 'Votre signalement a été clôturé',
};

const onReportUpdated = async (strapi, updated, previousStatus) => {
	const report = await strapi.documents(REPORT_UID).findOne({
		documentId: updated.documentId,
		fields: ['from', 'reportStatus', 'resolution'],
		populate: {
			patient: { fields: ['id'] },
			doctor: { fields: ['id'], populate: { users_permissions_user: { fields: ['id'] } } },
			appointment: { fields: ['UUID', 'datetime'] },
		},
	});
	const title = REPORT_UPDATES[report?.reportStatus];
	if (!title || report.reportStatus === (previousStatus || 'open')) return;

	const recipient = report.from === 'doctor' ? report.doctor?.users_permissions_user?.id : report.patient?.id;
	const when = report.appointment?.datetime ? `Rendez-vous du ${formatShortDate(report.appointment.datetime)}` : null;
	await notifier(strapi).notify({
		recipient,
		type: 'report_update',
		title,
		body: report.reportStatus === 'in_progress' ? when : report.resolution?.trim() || when,
		link: report.appointment?.UUID ? `/appointment/${report.appointment.UUID}` : '/dashboard',
		dedupeKey: `report_update:${report.documentId}:${report.reportStatus}:${Date.now()}`,
	});
};

module.exports = {
	uids: [RATING_UID, REPORT_UID],

	/** Statut du signalement avant une mise à jour (pour ne notifier qu'un vrai changement). */
	async before(strapi, context) {
		if (context.uid !== REPORT_UID || context.action !== 'update' || !context.params?.documentId) return null;
		const report = await strapi.documents(REPORT_UID).findOne({ documentId: context.params.documentId, fields: ['reportStatus'] });
		return report?.reportStatus || null;
	},

	async handle(strapi, context, result, previous) {
		if (!result?.documentId) return;
		if (context.uid === REPORT_UID && context.action === 'update' && context.params?.data?.reportStatus) {
			return onReportUpdated(strapi, result, previous);
		}
		if (context.action !== 'create') return;
		if (context.uid === RATING_UID) return onRating(strapi, result);
		if (context.uid === REPORT_UID) return onReport(strapi, result);
	},
};
