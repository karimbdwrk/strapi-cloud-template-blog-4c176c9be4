'use strict';

/**
 * notification service
 *
 * notify() est le seul point d'entrée pour créer une notification
 * (depuis les lifecycles et les tâches planifiées).
 */

const { createCoreService } = require('@strapi/strapi').factories;

const UID = 'api::notification.notification';

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
	 * @returns la notification créée, ou null si ignorée (doublon, destinataire absent, erreur)
	 */
	async notify({ recipient, type, title, body, link, appointment, dedupeKey }) {
		if (!recipient || !type || !title) return null;

		// Liens internes uniquement
		const safeLink = typeof link === 'string' && link.startsWith('/') && !link.startsWith('//') ? link : null;

		try {
			if (dedupeKey) {
				const exists = await strapi.documents(UID).findFirst({ filters: { dedupeKey }, fields: ['id'] });
				if (exists) return null;
			}

			return await strapi.documents(UID).create({
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
		} catch (error) {
			// Une notification ne doit jamais faire échouer l'action qui la déclenche
			strapi.log.error(`[notification] Échec de création (${type}) : ${error.message}`);
			return null;
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
