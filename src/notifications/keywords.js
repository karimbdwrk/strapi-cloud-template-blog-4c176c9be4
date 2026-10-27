'use strict';

/**
 * Notifications liées aux mots-clés proposés par les praticiens.
 *   - nouvelle proposition       → admins    : admin_keyword
 *   - proposition validée        → praticien : keyword_approved
 *   - proposition refusée        → praticien : keyword_rejected, avec le motif
 */

const { fullName, notifier } = require('./helpers');

const UID = 'api::keyword.keyword';

const withProposer = (strapi, documentId) =>
	strapi.documents(UID).findOne({
		documentId,
		fields: ['name', 'status', 'moderationNote'],
		populate: {
			proposedBy: { fields: ['firstname', 'lastname'], populate: { users_permissions_user: { fields: ['id'] } } },
		},
	});

const onProposal = async (strapi, created) => {
	const keyword = await withProposer(strapi, created.documentId);
	if (keyword?.status !== 'pending' || !keyword.proposedBy) return;
	await notifier(strapi).notifyAdmins({
		type: 'admin_keyword',
		title: `Mot-clé proposé : « ${keyword.name} »`,
		body: `Par ${fullName(keyword.proposedBy)}`,
		link: '/admin/moderation?onglet=mots-cles',
		dedupeKey: `admin_keyword:${keyword.documentId}`,
	});
};

const onModerated = async (strapi, updated, previousStatus) => {
	const keyword = await withProposer(strapi, updated.documentId);
	if (!keyword?.proposedBy || keyword.status === previousStatus || !['approved', 'rejected'].includes(keyword.status)) return;
	const approved = keyword.status === 'approved';
	await notifier(strapi).notify({
		recipient: keyword.proposedBy.users_permissions_user?.id,
		type: approved ? 'keyword_approved' : 'keyword_rejected',
		title: approved ? `Votre mot-clé « ${keyword.name} » a été validé` : `Votre mot-clé « ${keyword.name} » n’a pas été retenu`,
		body: approved ? 'Il apparaît maintenant sur votre profil et dans la recherche.' : keyword.moderationNote?.trim() || null,
		link: '/onboarding',
		dedupeKey: `keyword_${keyword.status}:${keyword.documentId}`,
	});
};

module.exports = {
	uids: [UID],

	async before(strapi, context) {
		if (context.action !== 'update' || !context.params?.documentId) return null;
		const keyword = await strapi.documents(UID).findOne({ documentId: context.params.documentId, fields: ['status'] });
		return keyword?.status || null;
	},

	async handle(strapi, context, result, previous) {
		if (!result?.documentId) return;
		if (context.action === 'create') return onProposal(strapi, result);
		if (context.action === 'update' && context.params?.data?.status) return onModerated(strapi, result, previous);
	},
};
