'use strict';

/**
 * Notifications liées au compte praticien.
 *   - isActive false → true    → praticien : account_validated (1re fois) / account_reactivated
 *   - isActive true  → false   → praticien : account_suspended
 *   - isRecommended → true     → praticien : recommended_granted
 *   - isRecommended → false    → praticien : recommended_removed (sauf si suspension simultanée)
 *   - profil complété, non validé → admins : admin_doctor_pending (une fois)
 */

const { fullName, notifier } = require('./helpers');

const UID = 'api::doctor.doctor';

const isComplete = (d) =>
	Boolean(
		d.firstname &&
			d.lastname &&
			d.description?.trim?.() &&
			d.categories?.length &&
			d.languages?.length &&
			d.priceRange?.minimum &&
			d.priceRange?.maximum
	);

module.exports = {
	uids: [UID],

	async before(strapi, context) {
		if (context.action !== 'update' || !context.params?.documentId) return null;
		return strapi.documents(UID).findOne({
			documentId: context.params.documentId,
			fields: ['isActive', 'isRecommended'],
		});
	},

	async handle(strapi, context, result, previous) {
		if (context.action !== 'update' || !result?.documentId) return;
		const data = context.params?.data || {};
		const n = notifier(strapi);

		const doctor = await strapi.documents(UID).findOne({
			documentId: result.documentId,
			fields: ['firstname', 'lastname', 'description', 'isActive', 'isRecommended', 'UUID'],
			populate: {
				users_permissions_user: { fields: ['id'] },
				categories: { fields: ['id'] },
				languages: { fields: ['id'] },
				priceRange: true,
			},
		});
		if (!doctor) return;
		const recipient = doctor.users_permissions_user?.id;
		const jobs = [];

		const wasActive = Boolean(previous?.isActive);
		const wasRecommended = Boolean(previous?.isRecommended);

		// Validation / réactivation
		if (data.isActive === true && !wasActive) {
			const alreadyValidated = await strapi.documents('api::notification.notification').findFirst({
				filters: { dedupeKey: `account_validated:${doctor.documentId}` },
				fields: ['id'],
			});
			jobs.push(
				alreadyValidated
					? n.notify({
							recipient,
							type: 'account_reactivated',
							title: 'Votre profil est de nouveau en ligne',
							body: 'Les patients peuvent à nouveau vous trouver et prendre rendez-vous.',
							link: '/dashboard',
					  })
					: n.notify({
							recipient,
							type: 'account_validated',
							title: 'Votre profil est en ligne',
							body: 'Bienvenue sur Meyana. Les patients peuvent maintenant prendre rendez-vous avec vous.',
							link: '/dashboard',
							dedupeKey: `account_validated:${doctor.documentId}`,
					  })
			);
		}

		// Suspension
		if (data.isActive === false && wasActive) {
			jobs.push(
				n.notify({
					recipient,
					type: 'account_suspended',
					title: 'Votre profil a été suspendu',
					body: 'Il n’apparaît plus dans la recherche. Contactez le support pour en savoir plus.',
					link: '/support',
				})
			);
		}

		// Badge « Recommandé »
		if (data.isRecommended === true && !wasRecommended) {
			jobs.push(
				n.notify({
					recipient,
					type: 'recommended_granted',
					title: 'Vous avez reçu le badge « Recommandé »',
					body: 'Il apparaît désormais sur votre profil et dans les résultats de recherche.',
					link: doctor.UUID ? `/doctor/${doctor.UUID}` : '/dashboard',
				})
			);
		}
		if (data.isRecommended === false && wasRecommended && data.isActive !== false) {
			jobs.push(
				n.notify({
					recipient,
					type: 'recommended_removed',
					title: 'Le badge « Recommandé » a été retiré de votre profil',
					body: 'Contactez le support si vous avez des questions.',
					link: '/support',
				})
			);
		}

		// Profil complété par le praticien et en attente de validation
		if (!doctor.isActive && isComplete(doctor)) {
			jobs.push(
				n.notifyAdmins({
					type: 'admin_doctor_pending',
					title: 'Nouveau praticien à valider',
					body: fullName(doctor),
					link: `/admin/validation?id=${doctor.documentId}`,
					dedupeKey: `admin_doctor_pending:${doctor.documentId}`,
				})
			);
		}

		await Promise.all(jobs);
	},
};
