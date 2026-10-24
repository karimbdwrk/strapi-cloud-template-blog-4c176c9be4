'use strict';

/**
 * Mot de passe oublié / réinitialisation / changement, avec les emails Meyana (Resend).
 *
 * Le plugin users-permissions envoie ses emails via le plugin email de Strapi, non
 * configuré ici : ses actions sont donc surchargées pour passer par notre envoi.
 * - forgotPassword : lien de réinitialisation valable 1 heure, réponse identique que le
 *   compte existe ou non (pas de découverte des adresses inscrites).
 * - resetPassword  : refuse un lien expiré, puis confirme le changement par email.
 * - changePassword : confirme le changement par email.
 */

const crypto = require('crypto');
const { errors } = require('@strapi/utils');
const { renderEmail, sendEmail } = require('../../notifications/email');

const USER_UID = 'plugin::users-permissions.user';
const RESET_LINK_TTL_MS = 60 * 60 * 1000; // 1 heure
const RESET_PAGE = '/mot-de-passe/reinitialiser';
const FORGOT_PAGE = '/mot-de-passe-oublie';

const greeting = (user) => (user?.firstname ? `Bonjour ${user.firstname},` : 'Bonjour,');

const parisDateTime = (date) =>
	date.toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'long', timeStyle: 'short' });

const sendResetLink = async (strapi, user, token) => {
	const { html, text } = renderEmail({
		title: 'Réinitialisez votre mot de passe',
		paragraphs: [
			greeting(user),
			'Vous avez demandé à réinitialiser le mot de passe de votre compte Meyana. Cliquez sur le bouton ci-dessous pour en choisir un nouveau.',
			'Ce lien est valable 1 heure et ne fonctionne qu’une seule fois.',
		],
		link: `${RESET_PAGE}?code=${token}`,
		cta: 'Choisir un nouveau mot de passe',
		footer: 'Vous n’êtes pas à l’origine de cette demande ? Ignorez simplement cet email : votre mot de passe actuel reste inchangé.',
	});
	const sent = await sendEmail({ to: user.email, subject: 'Réinitialisez votre mot de passe Meyana', html, text });
	if (!sent) strapi.log.warn('[auth] RESEND_API_KEY absente : email de réinitialisation non envoyé');
};

const sendPasswordChanged = async (strapi, user) => {
	if (!user?.email) return;
	const { html, text } = renderEmail({
		title: 'Votre mot de passe a été modifié',
		paragraphs: [
			greeting(user),
			`Le mot de passe de votre compte Meyana a bien été modifié le ${parisDateTime(new Date())} (heure de Paris).`,
			'Si vous êtes à l’origine de ce changement, vous n’avez rien à faire.',
			'Si ce n’est pas vous, réinitialisez votre mot de passe tout de suite et contactez-nous : quelqu’un a peut-être accès à votre compte.',
		],
		link: FORGOT_PAGE,
		cta: 'Ce n’était pas moi',
		footer: 'Cet email de sécurité est envoyé à chaque changement de mot de passe de votre compte Meyana.',
	});
	try {
		await sendEmail({ to: user.email, subject: 'Votre mot de passe Meyana a été modifié', html, text });
	} catch (error) {
		// Le mot de passe est déjà changé : l'échec de l'email ne doit pas faire échouer la requête
		strapi.log.error(`[auth] email de confirmation non envoyé : ${error.message}`);
	}
};

module.exports = (plugin) => {
	const createAuthController = plugin.controllers.auth;

	plugin.controllers.auth = ({ strapi }) => {
		const base = createAuthController({ strapi });

		return {
			...base,

			async forgotPassword(ctx) {
				const email = String(ctx.request.body?.email || '').trim().toLowerCase();
				if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
					throw new errors.ValidationError('Adresse email invalide');
				}

				const user = await strapi.db.query(USER_UID).findOne({ where: { email } });
				if (user && !user.blocked && user.provider === 'local') {
					const token = crypto.randomBytes(64).toString('hex');
					await strapi.db.query(USER_UID).update({
						where: { id: user.id },
						data: { resetPasswordToken: token, resetPasswordRequestedAt: new Date() },
					});
					try {
						await sendResetLink(strapi, user, token);
					} catch (error) {
						strapi.log.error(`[auth] email de réinitialisation non envoyé : ${error.message}`);
					}
				}

				// Même réponse dans tous les cas
				return ctx.send({ ok: true });
			},

			async resetPassword(ctx) {
				const code = ctx.request.body?.code;
				const user = code
					? await strapi.db.query(USER_UID).findOne({ where: { resetPasswordToken: code } })
					: null;

				if (user) {
					const requestedAt = user.resetPasswordRequestedAt ? new Date(user.resetPasswordRequestedAt) : null;
					if (!requestedAt || Date.now() - requestedAt.getTime() > RESET_LINK_TTL_MS) {
						await strapi.db.query(USER_UID).update({
							where: { id: user.id },
							data: { resetPasswordToken: null, resetPasswordRequestedAt: null },
						});
						throw new errors.ValidationError('Reset link expired');
					}
				}

				// Contrôles et changement du mot de passe par Strapi (erreur si code invalide)
				await base.resetPassword(ctx);

				if (user) {
					await strapi.db.query(USER_UID).update({
						where: { id: user.id },
						data: { resetPasswordRequestedAt: null },
					});
					await sendPasswordChanged(strapi, user);
				}
			},

			async changePassword(ctx) {
				await base.changePassword(ctx);
				const user = ctx.state.user
					? await strapi.db.query(USER_UID).findOne({ where: { id: ctx.state.user.id } })
					: null;
				await sendPasswordChanged(strapi, user);
			},
		};
	};

	return plugin;
};
