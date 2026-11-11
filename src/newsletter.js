'use strict';

/**
 * Newsletter : inscription depuis le pied de page du site, désinscription en un clic.
 *
 * - Chaque inscrit a un jeton secret : le lien de désinscription l'utilise, il ne se devine pas.
 * - Un email de bienvenue part à l'inscription, avec ce lien : la personne peut se désinscrire
 *   tout de suite (et sait qu'elle a été inscrite, si quelqu'un a saisi son adresse à sa place).
 * - Les réponses ne disent jamais si une adresse est déjà inscrite.
 * - Désinscription : l'adresse est gardée avec sa date de désinscription (preuve du retrait
 *   du consentement), et n'apparaît plus dans l'export.
 */

const crypto = require('crypto');
const { renderEmail, sendEmail, frontUrl } = require('./notifications/email');

const UID = 'api::newsletter.newsletter';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Limite d'inscriptions par adresse IP (mémoire du serveur) : évite d'envoyer en masse
// des emails de bienvenue à des tiers
const LIMIT = 5;
const WINDOW = 60 * 60 * 1000;
const attempts = new Map();

const clientIp = (ctx) => String(ctx.get('x-forwarded-for') || '').split(',')[0].trim() || ctx.ip || '';

const tooMany = (ip) => {
	const now = Date.now();
	for (const [key, list] of attempts) if (list.every((t) => now - t > WINDOW)) attempts.delete(key);
	const recent = (attempts.get(ip) || []).filter((t) => now - t < WINDOW);
	if (recent.length >= LIMIT) return true;
	attempts.set(ip, [...recent, now]);
	return false;
};

const newToken = () => crypto.randomBytes(24).toString('base64url');

const normalize = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

const unsubscribeUrl = (token) => `${frontUrl()}/newsletter/desinscription?token=${encodeURIComponent(token)}`;

const welcomeEmail = (token) => {
	const url = unsubscribeUrl(token);
	const { html, text } = renderEmail({
		title: 'Bienvenue dans la newsletter Meyana',
		paragraphs: [
			'Bonjour,',
			'Votre inscription est bien enregistrée : vous recevrez nos conseils, nos articles et nos actualités autour de la santé et du bien-être.',
		],
		link: '/blog',
		cta: 'Lire nos articles',
		secondary: { url, label: 'Me désinscrire' },
		notes: ['Vous n’êtes pas à l’origine de cette inscription ? Cliquez sur « Me désinscrire » : vous ne recevrez plus rien.'],
		footer: 'Vous recevez cet email car cette adresse a été inscrite à la newsletter Meyana. Chaque newsletter contient un lien de désinscription.',
	});
	return {
		subject: 'Votre inscription à la newsletter Meyana',
		html,
		text,
		headers: {
			'List-Unsubscribe': `<${url}>`,
		},
	};
};

const findByEmail = (strapi, email) =>
	strapi.db.query(UID).findOne({ where: { email: { $eqi: email } }, orderBy: { id: 'asc' } });

/**
 * Inscrit une adresse (ou la réinscrit après une désinscription).
 * @returns {'invalid'|'limited'|'ok'}
 */
const subscribe = async (strapi, ctx, rawEmail) => {
	const email = normalize(rawEmail);
	if (!EMAIL_PATTERN.test(email) || email.length > 254) return 'invalid';

	const existing = await findByEmail(strapi, email);
	// Déjà inscrit : même réponse, aucun email (pas de renvoi en boucle)
	if (existing && !existing.unsubscribedAt) return 'ok';
	if (tooMany(clientIp(ctx))) return 'limited';

	const token = existing?.token || newToken();
	const data = { email, token, subscribedAt: new Date(), unsubscribedAt: null };
	if (existing) await strapi.db.query(UID).update({ where: { id: existing.id }, data });
	else await strapi.db.query(UID).create({ data });

	try {
		if (!(await sendEmail({ to: email, ...welcomeEmail(token) }))) {
			strapi.log.warn('Newsletter : email de bienvenue non envoyé (RESEND_API_KEY absente)');
		}
	} catch (error) {
		strapi.log.error(`Newsletter : email de bienvenue non envoyé (${error.message})`);
	}
	return 'ok';
};

/** Désinscription par le lien reçu. @returns {boolean} jeton reconnu */
const unsubscribeByToken = async (strapi, token) => {
	if (typeof token !== 'string' || token.length < 16 || token.length > 100) return false;
	const row = await strapi.db.query(UID).findOne({ where: { token } });
	if (!row) return false;
	if (!row.unsubscribedAt) {
		await strapi.db.query(UID).update({ where: { id: row.id }, data: { unsubscribedAt: new Date() } });
	}
	return true;
};

/** Désinscription en saisissant son adresse (sans lien sous la main). Réponse identique dans tous les cas. */
const unsubscribeByEmail = async (strapi, rawEmail) => {
	const email = normalize(rawEmail);
	if (!EMAIL_PATTERN.test(email)) return;
	await strapi.db.query(UID).updateMany({
		where: { email: { $eqi: email }, unsubscribedAt: { $null: true } },
		data: { unsubscribedAt: new Date() },
	});
};

const csvCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

/** Export des inscrits actifs (SuperAdmin), avec le lien de désinscription à mettre dans chaque envoi */
const exportCsv = async (strapi) => {
	const rows = await strapi.db.query(UID).findMany({
		where: { unsubscribedAt: { $null: true }, email: { $notNull: true } },
		select: ['email', 'subscribedAt', 'createdAt', 'token'],
		orderBy: { id: 'asc' },
	});
	const lines = [['email', 'inscrit_le', 'lien_desinscription'].join(';')];
	for (const r of rows) {
		lines.push([r.email, new Date(r.subscribedAt || r.createdAt).toISOString().slice(0, 10), unsubscribeUrl(r.token)].map(csvCell).join(';'));
	}
	return `﻿${lines.join('\r\n')}\r\n`;
};

/** Inscrits d'avant cette version : adresse normalisée, jeton et date d'inscription ajoutés */
const ensureNewsletterTokens = async (strapi) => {
	const rows = await strapi.db.query(UID).findMany({
		where: { $or: [{ token: { $null: true } }, { subscribedAt: { $null: true } }] },
		select: ['id', 'email', 'token', 'subscribedAt', 'createdAt'],
	});
	for (const r of rows) {
		await strapi.db.query(UID).update({
			where: { id: r.id },
			data: {
				email: normalize(r.email) || null,
				token: r.token || newToken(),
				subscribedAt: r.subscribedAt || r.createdAt || new Date(),
			},
		});
	}
};

module.exports = { subscribe, unsubscribeByToken, unsubscribeByEmail, exportCsv, ensureNewsletterTokens };
