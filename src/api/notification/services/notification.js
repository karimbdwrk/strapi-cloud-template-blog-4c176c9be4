'use strict';

/**
 * notification service
 *
 * notify() est le seul point d'entrée pour créer une notification
 * (depuis les lifecycles et les tâches planifiées).
 */

const { createCoreService } = require('@strapi/strapi').factories;

const UID = 'api::notification.notification';
const { shouldEmail, renderEmail, sendEmail, categoryOf } = require('../../../notifications/email');

const clip = (value, max) => (typeof value === 'string' && value.length > max ? `${value.slice(0, max - 1)}…` : value);

module.exports = createCoreService(UID, ({ strapi }) => ({
	/**
	 * Crée une notification pour un utilisateur.
	 *
	 * @param {object}  params
	 * @param {number}  params.recipient     id du user (users-permissions)
	 * @param {string}  params.type          une valeur de l'énumération `type`
	 * @param {string}  params.title         texte principal (120 caractères max)
	 * @param {string}  [params.body]        détail, sans donnée de santé
	 * @param {string}  [params.link]        chemin interne commençant par « / »
	 * @param {string}  [params.appointment] documentId du rendez-vous lié
	 * @param {string}  [params.dedupeKey]   clé anti-doublon (ex. « appointment_reminder:abc »)
	 * @param {object}  [params.email]       email sur mesure { subject, html, text, attachments },
	 *                                       à la place du gabarit générique de notification
	 * @returns la notification créée, ou null si ignorée (doublon, destinataire absent, erreur)
	 */
	async notify({ recipient, type, title, body, link, appointment, dedupeKey, email }) {
		if (!recipient || !type || !title) return null;

		// Liens internes uniquement
		const safeLink = typeof link === 'string' && link.startsWith('/') && !link.startsWith('//') ? link : null;

		try {
			if (dedupeKey) {
				const exists = await strapi.documents(UID).findFirst({ filters: { dedupeKey }, fields: ['id'] });
				if (exists) return null;
			}

			const created = await strapi.documents(UID).create({
				data: {
					recipient,
					type,
					title: clip(title, 120),
					body: clip(body, 300) || null,
					link: safeLink,
					appointment: appointment || null,
					dedupeKey: dedupeKey || null,
				},
			});

			if (shouldEmail(type)) await this.emailNotification(created, recipient, email);
			return created;
		} catch (error) {
			// Une notification ne doit jamais faire échouer l'action qui la déclenche
			strapi.log.error(`[notification] Échec de création (${type}) : ${error.message}`);
			return null;
		}
	},

	/** Envoie la notification par email (une seule fois, tracé dans emailSentAt). */
	async emailNotification(notification, recipientId, custom) {
		try {
			const user = await strapi.db.query('plugin::users-permissions.user').findOne({
				where: { id: recipientId },
				select: ['email', 'blocked', 'emailPreferences'],
			});
			if (!user?.email || user.blocked) return;
			// Catégorie désactivée dans les réglages : notification dans le site uniquement
			const category = categoryOf(notification.type);
			if (category && user.emailPreferences?.[category] === false) return;

			const message = custom || { subject: notification.title, ...renderEmail(notification) };
			const sent = await sendEmail({ to: user.email, ...message });
			if (!sent) return; // RESEND_API_KEY absente : notification dans le site uniquement

			await strapi.documents(UID).update({
				documentId: notification.documentId,
				data: { emailSentAt: new Date() },
			});
		} catch (error) {
			strapi.log.error(`[notification] Email non envoyé (${notification.type}) : ${error.message}`);
		}
	},

	/** Notifie tous les comptes ayant le rôle SuperAdmin. */
	async notifyAdmins(params) {
		const admins = await strapi.db.query('plugin::users-permissions.user').findMany({
			where: { role: { name: 'SuperAdmin' } },
			select: ['id'],
		});
		await Promise.all(
			admins.map((admin) =>
				this.notify({
					...params,
					recipient: admin.id,
					dedupeKey: params.dedupeKey ? `${params.dedupeKey}:${admin.id}` : undefined,
				})
			)
		);
	},
}));
