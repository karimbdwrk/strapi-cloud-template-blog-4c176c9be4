'use strict';

/**
 * Notifications liées au support.
 * - Message de l'équipe        → le demandeur reçoit « support_reply »
 * - Message d'un utilisateur   → les admins reçoivent « admin_support »
 * - Demande passée en résolue  → le demandeur reçoit « support_resolved »
 */

const MESSAGE_UID = 'api::support-message.support-message';
const TICKET_UID = 'api::support-ticket.support-ticket';

const fullName = (u) => [u?.lastname, u?.firstname].filter(Boolean).join(' ') || u?.username || u?.email || 'Un utilisateur';

const onMessageCreated = async (strapi, created) => {
	const notifications = strapi.service('api::notification.notification');

	const message = await strapi.documents(MESSAGE_UID).findOne({
		documentId: created.documentId,
		populate: {
			users_permissions_user: { fields: ['id', 'firstname', 'lastname', 'username', 'email'] },
			support_ticket: { populate: { users_permissions_user: { fields: ['id'] } } },
		},
	});
	const ticket = message?.support_ticket;
	if (!ticket) return;

	if (message.fromAdmin) {
		await notifications.notify({
			recipient: ticket.users_permissions_user?.id,
			type: 'support_reply',
			title: 'L’équipe Meyana a répondu à votre demande',
			body: ticket.subject,
			link: `/support/${ticket.documentId}`,
			dedupeKey: `support_reply:${message.documentId}`,
		});
		return;
	}

	// Premier message = nouvelle demande, sinon nouvelle réponse de l'utilisateur
	const messagesCount = await strapi.documents(MESSAGE_UID).count({
		filters: { support_ticket: { documentId: ticket.documentId } },
	});
	await notifications.notifyAdmins({
		type: 'admin_support',
		title: messagesCount <= 1 ? 'Nouvelle demande de support' : 'Nouvelle réponse sur une demande de support',
		body: `${fullName(message.users_permissions_user)} · ${ticket.subject}`,
		link: `/admin/support/${ticket.documentId}`,
		dedupeKey: `admin_support:${message.documentId}`,
	});
};

const onTicketUpdated = async (strapi, params, updated) => {
	if (params?.data?.ticketStatus !== 'resolved') return;

	const ticket = await strapi.documents(TICKET_UID).findOne({
		documentId: updated.documentId,
		populate: { users_permissions_user: { fields: ['id'] } },
	});
	if (!ticket) return;

	await strapi.service('api::notification.notification').notify({
		recipient: ticket.users_permissions_user?.id,
		type: 'support_resolved',
		title: 'Votre demande a été marquée comme résolue',
		body: ticket.subject,
		link: `/support/${ticket.documentId}`,
	});
};

module.exports = {
	uids: [MESSAGE_UID, TICKET_UID],

	/** Appelé par le middleware du document service (voir src/notifications/index.js). */
	async handle(strapi, context, result) {
		if (!result?.documentId) return;
		if (context.uid === MESSAGE_UID && context.action === 'create') {
			await onMessageCreated(strapi, result);
		}
		if (context.uid === TICKET_UID && context.action === 'update') {
			await onTicketUpdated(strapi, context.params, result);
		}
	},
};
