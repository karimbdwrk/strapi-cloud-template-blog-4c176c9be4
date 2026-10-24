'use strict';

/**
 * Envoi par email (Resend) des notifications importantes.
 *
 * Variables d'environnement :
 *   RESEND_API_KEY  clé API Resend (sans elle, aucun email n'est envoyé)
 *   RESEND_FROM     expéditeur, ex. « Meyana <noreply@meyana.fr> »
 *   FRONT_URL       adresse du site, ex. « https://meyana.fr » (pour les liens)
 */

// Types de notification qui partent aussi par email.
// Exclus : note_added (trop fréquent) et appointment_to_close (rappel interne).
const EMAIL_TYPES = new Set([
	'appointment_booked',
	'appointment_added_by_doctor',
	'appointment_cancelled',
	'appointment_reminder',
	'visio_link_added',
	'document_added',
	'review_request',
	'review_received',
	'account_validated',
	'account_suspended',
	'account_reactivated',
	'recommended_granted',
	'recommended_removed',
	'support_reply',
	'support_resolved',
	'admin_doctor_pending',
	'admin_report',
	'admin_support',
]);

const ctaLabel = (type) => {
	if (type === 'review_request') return 'Donner mon avis';
	if (type.startsWith('appointment') || type === 'visio_link_added' || type === 'document_added') return 'Voir le rendez-vous';
	if (type.startsWith('support')) return 'Voir ma demande';
	if (type.startsWith('admin')) return 'Ouvrir l’administration';
	if (type === 'review_received' || type.startsWith('recommended')) return 'Voir mon profil';
	return 'Accéder à mon espace';
};

const escapeHtml = (value) =>
	String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');

const frontUrl = () => (process.env.FRONT_URL || 'http://localhost:3010').replace(/\/$/, '');

/**
 * Gabarit des emails Meyana.
 * Notifications : { type, title, body, link }.
 * Emails de compte : { title, paragraphs: [...], link, cta, footer } (bouton et pied de page sur mesure).
 */
const renderEmail = ({ type, title, body, paragraphs, link, cta: ctaText, footer }) => {
	const url = link ? `${frontUrl()}${link}` : `${frontUrl()}/dashboard`;
	const cta = ctaText || ctaLabel(type || '');
	const lines = paragraphs || (body ? [body] : []);
	const footerHtml = footer
		? escapeHtml(footer)
		: `Vous recevez cet email car vous avez un compte Meyana. Retrouvez toutes vos notifications dans <a href="${escapeHtml(`${frontUrl()}/notifications`)}" style="color:#4b5a43">votre espace</a>.`;
	const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;background:#fbf7f4;font-family:Arial,Helvetica,sans-serif;color:#1e352f">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fbf7f4;padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
<tr><td style="padding:0 4px 16px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#4b5a43;font-weight:bold">Meyana</td></tr>
<tr><td style="background:#ffffff;border:1px solid #ece3db;border-radius:20px;padding:32px">
<h1 style="margin:0 0 12px;font-family:Georgia,'Times New Roman',serif;font-weight:normal;font-size:24px;line-height:1.25;color:#1e352f">${escapeHtml(title)}</h1>
${lines
	.map(
		(line, i) =>
			`<p style="margin:0 0 ${i === lines.length - 1 ? 24 : 12}px;font-size:15px;line-height:1.6;color:#4a4a4a">${escapeHtml(line)}</p>`
	)
	.join('\n')}
<a href="${escapeHtml(url)}" style="display:inline-block;background:#1e352f;color:#fbf7f4;text-decoration:none;font-size:14px;font-weight:bold;padding:12px 22px;border-radius:999px">${escapeHtml(cta)}</a>
</td></tr>
<tr><td style="padding:20px 4px 0;font-size:12px;line-height:1.6;color:#8a8a8a">
${footerHtml}<br>
Meyana ne remplace pas un avis médical d’urgence : en cas d’urgence, composez le 15 ou le 112.
</td></tr>
</table></td></tr></table></body></html>`;
	const text = `${title}\n\n${lines.map((line) => `${line}\n\n`).join('')}${cta} : ${url}${footer ? `\n\n${footer}` : ''}\n\n—\nMeyana. En cas d'urgence, composez le 15 ou le 112.`;
	return { html, text };
};

const shouldEmail = (type) => EMAIL_TYPES.has(type);

/** Envoie l'email via l'API Resend. Renvoie true si accepté. */
const sendEmail = async ({ to, subject, html, text }) => {
	const apiKey = process.env.RESEND_API_KEY;
	if (!apiKey) return false;
	const res = await fetch('https://api.resend.com/emails', {
		method: 'POST',
		headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({
			from: process.env.RESEND_FROM || 'Meyana <noreply@meyana.fr>',
			to: [to],
			subject,
			html,
			text,
		}),
	});
	if (!res.ok) {
		const detail = await res.text().catch(() => '');
		throw new Error(`Resend ${res.status} ${detail.slice(0, 200)}`);
	}
	return true;
};

module.exports = { shouldEmail, renderEmail, sendEmail, frontUrl };
