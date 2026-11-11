'use strict';

/**
 * Alertes de paiement : emails (et notifications dans le site) quand quelque chose bloque.
 *
 * Praticien (réglage « compte ») :
 * - subscription_alert : prélèvement de l'abonnement refusé, fin de la période d'essai (ou des
 *   mois offerts) dans 3 jours, abonnement Premium terminé ;
 * - payments_alert : compte de paiement à compléter ou suspendu, paiement d'une consultation
 *   contesté (et issue de la contestation), virement refusé par la banque.
 * Admins (réglage « admin ») :
 * - admin_payments : contestation ouverte ou close, virement refusé, virement du lundi impossible,
 *   compte de paiement d'un praticien en ligne suspendu.
 *
 * Déclenchées par les webhooks Stripe (src/billing.js) et par la vérification quotidienne des
 * comptes (config/cron-tasks.js). Chaque alerte a une clé anti-doublon : un événement reçu deux
 * fois, ou un état déjà signalé, n'envoie rien de plus.
 *
 * Le prestataire de paiement n'est jamais nommé dans les textes.
 */

const crypto = require('crypto');
const { renderEmail } = require('./notifications/email');
const { TIME_ZONE, formatWhen, fullName, notifier } = require('./notifications/helpers');

const DOCTOR = 'api::doctor.doctor';
const APPOINTMENT = 'api::appointment.appointment';
const DOCTOR_SELECT = ['id', 'documentId', 'firstname', 'lastname', 'isActive', 'offeredUntil', 'stripeAccountId', 'paymentsEnabled'];

/* ------------------------------------------------------------------ */
/* Outils                                                              */
/* ------------------------------------------------------------------ */

const euros = (cents) => {
	const n = Number(cents) / 100;
	const digits = Number.isInteger(n) ? 0 : 2;
	return `${n.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits })} €`;
};

/** « 14 novembre 2026 » depuis un horodatage Stripe (secondes) ou une date */
const dayOf = (value) => {
	if (!value) return '';
	const date = typeof value === 'number' ? new Date(value * 1000) : new Date(value);
	return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: TIME_ZONE });
};

const hello = (doctor) => (doctor?.firstname ? `Bonjour ${doctor.firstname},` : 'Bonjour,');

const doctorLabel = (doctor) => fullName(doctor) || doctor?.documentId || 'praticien inconnu';

const shortHash = (value) => crypto.createHash('sha256').update(value).digest('hex').slice(0, 12);

const findDoctor = (strapi, where) =>
	strapi.db.query(DOCTOR).findOne({
		where,
		select: DOCTOR_SELECT,
		populate: { users_permissions_user: { select: ['id'] } },
	});

/** Notification + email au praticien (respecte son réglage « compte ») */
const notifyDoctor = (strapi, doctor, { type, title, body, link, dedupeKey, email }) => {
	const recipient = doctor?.users_permissions_user?.id;
	if (!recipient) {
		strapi.log.warn(`Alertes de paiement : ${type} non envoyée, praticien ${doctor?.documentId} sans compte`);
		return null;
	}
	return notifier(strapi).notify({ recipient, type, title, body, link, dedupeKey, email });
};

/** Notification + email à tous les admins */
const notifyAdmins = (strapi, { title, body, link, dedupeKey, email }) =>
	notifier(strapi).notifyAdmins({ type: 'admin_payments', title, body, link, dedupeKey, email });

const adminEmail = ({ title, paragraphs, details, notes, link, cta = 'Ouvrir l’administration' }) => ({
	subject: `[Admin] ${title}`,
	...renderEmail({ title, paragraphs, details, notes, link, cta }),
});

/* ------------------------------------------------------------------ */
/* Abonnement                                                          */
/* ------------------------------------------------------------------ */

const customerOf = (object) => (typeof object.customer === 'string' ? object.customer : object.customer?.id);

/** invoice.payment_failed : prélèvement de l'abonnement refusé */
const onSubscriptionPaymentFailed = async (strapi, invoice) => {
	if (!invoice.amount_due) return;
	const doctor = await findDoctor(strapi, { stripeCustomerId: customerOf(invoice) });
	if (!doctor) return;

	const amount = euros(invoice.amount_due);
	const retry = invoice.next_payment_attempt ? dayOf(invoice.next_payment_attempt) : null;
	const { html, text } = renderEmail({
		title: 'Le paiement de votre abonnement a échoué',
		paragraphs: [
			hello(doctor),
			`Nous n’avons pas pu prélever ${amount} pour votre abonnement Premium : le paiement a été refusé (carte expirée, plafond atteint ou refus de votre banque).`,
			retry
				? `Une nouvelle tentative aura lieu le ${retry}. Mettez à jour votre carte d’ici là pour garder l’agenda en ligne et le paiement des consultations.`
				: 'Sans paiement, votre abonnement Premium va s’arrêter et votre profil repassera en offre Essentiel (rendez-vous par téléphone uniquement).',
		],
		details: [
			['Montant', amount],
			['Prochaine tentative', retry],
		],
		link: '/dashboard/abonnement',
		cta: 'Mettre à jour ma carte',
		secondary: invoice.hosted_invoice_url ? { url: invoice.hosted_invoice_url, label: 'Régler la facture en ligne' } : null,
		notes: ['Votre profil reste visible pendant ce temps, et les rendez-vous déjà pris sont conservés.'],
	});

	await notifyDoctor(strapi, doctor, {
		type: 'subscription_alert',
		title: 'Le paiement de votre abonnement a échoué',
		body: retry ? `Nouvelle tentative le ${retry} : mettez à jour votre carte.` : 'Mettez à jour votre carte pour garder Premium.',
		link: '/dashboard/abonnement',
		dedupeKey: `subscription_alert:failed:${invoice.id}:${invoice.attempt_count || 1}`,
		email: { subject: `Paiement de votre abonnement refusé · ${amount}`, html, text },
	});
};

/** Montant facturé après l'essai, d'après la formule de l'abonnement */
const priceLabelOf = (subscription) => {
	const price = subscription.items?.data?.[0]?.price;
	if (!price?.unit_amount) return null;
	return price.recurring?.interval === 'year'
		? `${euros(price.unit_amount)} par an (soit ${euros(price.unit_amount / 12)} par mois)`
		: `${euros(price.unit_amount)} par mois`;
};

/** customer.subscription.trial_will_end : envoyé par Stripe 3 jours avant la fin de l'essai */
const onTrialWillEnd = async (strapi, subscription) => {
	if (subscription.status !== 'trialing' || !subscription.trial_end) return;
	const doctor = await findDoctor(strapi, { stripeCustomerId: customerOf(subscription) });
	if (!doctor) return;

	const end = dayOf(subscription.trial_end);
	// Fin de mois offerts par l'admin (l'essai a été prolongé jusqu'à cette date)
	const offered =
		doctor.offeredUntil && Math.abs(new Date(doctor.offeredUntil).getTime() - subscription.trial_end * 1000) < 2 * 86400000;
	const period = offered ? 'vos mois Premium offerts' : 'votre mois d’essai Premium';
	const stopping = Boolean(subscription.cancel_at_period_end || subscription.cancel_at);
	const price = priceLabelOf(subscription);
	const title = offered ? `Vos mois Premium offerts se terminent le ${end}` : `Votre essai Premium se termine le ${end}`;

	const { html, text } = renderEmail({
		title,
		paragraphs: [
			hello(doctor),
			stopping
				? `${period.charAt(0).toUpperCase()}${period.slice(1)} se ${offered ? 'terminent' : 'termine'} le ${end}. Vous avez résilié votre abonnement : à cette date, votre profil repassera en offre Essentiel (rendez-vous par téléphone uniquement).`
				: `${period.charAt(0).toUpperCase()}${period.slice(1)} se ${offered ? 'terminent' : 'termine'} le ${end}. Votre abonnement continue ensuite automatiquement${
						price ? ` : ${price}, prélevés sur la carte enregistrée` : ''
				  }.`,
		],
		details: [
			['Fin de la période gratuite', end],
			['Ensuite', stopping ? 'Offre Essentiel (gratuite)' : price],
		],
		link: '/dashboard/abonnement',
		cta: stopping ? 'Garder Premium' : 'Gérer mon abonnement',
		notes: stopping
			? ['Vous changez d’avis ? Réactivez votre abonnement avant le ' + end + ' pour garder l’agenda en ligne et le paiement des consultations.']
			: [
					'Rien à faire pour continuer. Pour changer de formule (mensuelle ou annuelle) ou résilier sans frais, rendez-vous sur votre page Abonnement avant cette date.',
					'Vous recevrez la facture par email après chaque paiement.',
			  ],
	});

	await notifyDoctor(strapi, doctor, {
		type: 'subscription_alert',
		title,
		body: stopping ? 'Votre profil repassera ensuite en offre Essentiel.' : price ? `Ensuite : ${price}.` : 'Votre abonnement continue ensuite.',
		link: '/dashboard/abonnement',
		dedupeKey: `subscription_alert:trial:${subscription.id}:${subscription.trial_end}`,
		email: { subject: title, html, text },
	});
};

/**
 * customer.subscription.deleted : l'abonnement Premium est terminé.
 * @param {object} before praticien lu avant la synchronisation (statut précédent)
 * @param {object} after  praticien après synchronisation (plan recalculé)
 */
const onSubscriptionEnded = async (strapi, subscription, before, after) => {
	if (!before || before.stripeSubscriptionId !== subscription.id) return;
	if (!['trialing', 'active', 'past_due'].includes(before.subscriptionStatus)) return;
	// Encore Premium (mois offerts en cours) : rien à annoncer
	if (after?.plan === 'premium') return;
	const doctor = await findDoctor(strapi, { id: before.id });
	if (!doctor) return;

	const unpaid = subscription.cancellation_details?.reason === 'payment_failed';
	const { html, text } = renderEmail({
		title: 'Votre abonnement Premium a pris fin',
		paragraphs: [
			hello(doctor),
			unpaid
				? 'Le paiement de votre abonnement n’a pas pu être prélevé malgré plusieurs tentatives : votre abonnement Premium est arrêté.'
				: 'Votre abonnement Premium est arrivé à son terme, comme vous l’aviez demandé.',
			'Votre profil reste en ligne en offre Essentiel : vos patients vous contactent par téléphone. Les rendez-vous déjà pris sont conservés.',
		],
		link: '/dashboard/abonnement',
		cta: 'Reprendre Premium',
		notes: ['Vous pouvez reprendre Premium à tout moment depuis votre page Abonnement.'],
	});

	await notifyDoctor(strapi, doctor, {
		type: 'subscription_alert',
		title: 'Votre abonnement Premium a pris fin',
		body: 'Votre profil est passé en offre Essentiel.',
		link: '/dashboard/abonnement',
		dedupeKey: `subscription_alert:ended:${subscription.id}`,
		email: { subject: 'Votre abonnement Premium a pris fin', html, text },
	});
};

/* ------------------------------------------------------------------ */
/* Compte de paiement du praticien                                     */
/* ------------------------------------------------------------------ */

/**
 * Compare l'état du compte (relu chez Stripe) à ce qui était connu, et prévient le praticien
 * quand il doit agir : informations demandées, encaissements ou virements bloqués.
 * Un compte jamais terminé (inscription en cours) n'est pas signalé : la page Paiements le guide.
 * @param {boolean} wasEnabled paymentsEnabled avant la relecture
 */
const checkAccount = async (strapi, doctor, account, wasEnabled) => {
	if (!account || (!account.details_submitted && !wasEnabled)) return;
	const requirements = account.requirements || {};
	const due = [...new Set([...(requirements.past_due || []), ...(requirements.currently_due || [])])].sort();
	const chargesBlocked = !account.charges_enabled;
	const payoutsBlocked = !account.payouts_enabled;
	if (!due.length && !chargesBlocked && !payoutsBlocked) return;

	const full = doctor.users_permissions_user ? doctor : await findDoctor(strapi, { id: doctor.id });
	const state = shortHash(JSON.stringify({ due, chargesBlocked, payoutsBlocked, reason: requirements.disabled_reason || null }));
	const deadline = requirements.current_deadline ? dayOf(requirements.current_deadline) : null;

	const title = chargesBlocked
		? 'Vos paiements en ligne sont suspendus'
		: payoutsBlocked
		? 'Vos virements sont suspendus'
		: 'Informations à compléter sur votre compte de paiement';
	const paragraphs = [hello(full)];
	if (chargesBlocked) {
		paragraphs.push(
			'Votre compte de paiement ne peut plus encaisser : vos patients réservent sans payer en ligne, et la consultation se règle au cabinet.'
		);
	} else if (payoutsBlocked) {
		paragraphs.push('Les paiements en ligne continuent, mais les virements vers votre compte bancaire sont bloqués.');
	}
	paragraphs.push(
		due.length
			? `Notre prestataire de paiement a besoin d’informations complémentaires${deadline ? ` avant le ${deadline}` : ''} : complétez votre compte depuis votre page Paiements, en quelques minutes.`
			: 'Ouvrez votre page Paiements pour voir ce qui bloque et compléter votre compte.'
	);
	const { html, text } = renderEmail({
		title,
		paragraphs,
		details: [['Date limite', deadline]],
		link: '/dashboard/paiements',
		cta: 'Compléter mon compte',
		notes: [
			'Les informations demandées (pièce d’identité, justificatif, IBAN…) se renseignent dans le formulaire sécurisé de notre prestataire, ouvert depuis votre page Paiements.',
			'Une question ? Contactez notre équipe depuis votre espace.',
		],
	});

	await notifyDoctor(strapi, full, {
		type: 'payments_alert',
		title,
		body: deadline ? `À compléter avant le ${deadline}.` : 'Complétez votre compte depuis votre page Paiements.',
		link: '/dashboard/paiements',
		dedupeKey: `payments_alert:account:${account.id}:${state}`,
		email: { subject: title, html, text },
	});

	// Praticien en ligne qui ne peut plus encaisser : l'équipe est prévenue
	if (chargesBlocked && wasEnabled && full.isActive) {
		await notifyAdmins(strapi, {
			title: `Paiements suspendus : ${doctorLabel(full)}`,
			body: 'Son compte de paiement ne peut plus encaisser.',
			link: `/admin/praticiens/${full.documentId}`,
			dedupeKey: `admin_payments:account:${account.id}:${state}`,
			email: adminEmail({
				title: `Paiements suspendus : ${doctorLabel(full)}`,
				paragraphs: [
					'Le compte de paiement de ce praticien ne peut plus encaisser. Ses patients réservent sans payer en ligne. Le praticien a été prévenu par email.',
				],
				details: [
					['Praticien', doctorLabel(full)],
					['Motif', requirements.disabled_reason],
					['Informations demandées', due.join(', ')],
					['Date limite', deadline],
				],
				link: `/admin/praticiens/${full.documentId}`,
				cta: 'Voir le praticien',
			}),
		});
	}
};

/** account.updated (webhook des comptes des praticiens) */
const onAccountUpdated = async (strapi, account) => {
	const doctor = await strapi.db.query(DOCTOR).findOne({
		where: { stripeAccountId: account.id },
		select: DOCTOR_SELECT,
		populate: { users_permissions_user: { select: ['id'] } },
	});
	if (!doctor) return;
	const wasEnabled = Boolean(doctor.paymentsEnabled);
	const paymentsEnabled = Boolean(account.charges_enabled);
	if (paymentsEnabled !== wasEnabled) {
		await strapi.db.query(DOCTOR).update({ where: { id: doctor.id }, data: { paymentsEnabled } });
	}
	await checkAccount(strapi, doctor, account, wasEnabled);
};

/** Vérification quotidienne de tous les comptes (filet si un webhook n'arrive pas) */
const checkPaymentAccounts = async (strapi) => {
	const { syncAccount } = require('./payments');
	const doctors = await strapi.db.query(DOCTOR).findMany({
		where: { stripeAccountId: { $notNull: true } },
		select: [...DOCTOR_SELECT, 'stripeCustomerId'],
		populate: { users_permissions_user: { select: ['id'] } },
		limit: 5000,
	});
	for (const doctor of doctors) {
		try {
			const wasEnabled = Boolean(doctor.paymentsEnabled);
			const synced = await syncAccount(strapi, doctor);
			await checkAccount(strapi, doctor, synced.account, wasEnabled);
		} catch (error) {
			strapi.log.error(`Alertes de paiement : compte du praticien ${doctor.documentId} non vérifié (${error.message})`);
		}
	}
};

/* ------------------------------------------------------------------ */
/* Contestations de paiement                                           */
/* ------------------------------------------------------------------ */

// Motifs de contestation des banques, en clair
const DISPUTE_REASONS = {
	fraudulent: 'Paiement non reconnu par le titulaire de la carte',
	duplicate: 'Paiement en double',
	product_not_received: 'Consultation non reçue',
	product_unacceptable: 'Consultation jugée non conforme',
	subscription_canceled: 'Abonnement résilié',
	credit_not_processed: 'Remboursement attendu',
	unrecognized: 'Paiement non reconnu',
	general: 'Autre motif',
};

const intentOf = (dispute) => (typeof dispute.payment_intent === 'string' ? dispute.payment_intent : dispute.payment_intent?.id);

const disputedAppointment = (strapi, dispute) =>
	intentOf(dispute)
		? strapi.db.query(APPOINTMENT).findOne({
				where: { paymentIntentId: intentOf(dispute) },
				select: ['id', 'documentId', 'UUID', 'datetime', 'price', 'paidOutAt', 'disputeStatus'],
				populate: { doctor: { select: DOCTOR_SELECT, populate: { users_permissions_user: { select: ['id'] } } } },
		  })
		: null;

/** charge.dispute.created : versement de la consultation suspendu, praticien et admins prévenus */
const onDisputeCreated = async (strapi, dispute) => {
	const appointment = await disputedAppointment(strapi, dispute);
	if (!appointment) {
		strapi.log.warn(`Alertes de paiement : contestation ${dispute.id} sans rendez-vous connu`);
		return;
	}
	await strapi.db.query(APPOINTMENT).update({
		where: { id: appointment.id },
		data: { disputeStatus: 'open', disputedAt: new Date() },
	});
	const doctor = appointment.doctor;
	const amount = euros(dispute.amount);
	const when = formatWhen(appointment.datetime);
	const reason = DISPUTE_REASONS[dispute.reason] || DISPUTE_REASONS.general;
	const dueBy = dispute.evidence_details?.due_by ? dayOf(dispute.evidence_details.due_by) : null;

	const { html, text } = renderEmail({
		title: 'Un paiement est contesté',
		paragraphs: [
			hello(doctor),
			`Le titulaire de la carte conteste auprès de sa banque le paiement de la consultation du ${when} (${amount}).`,
			appointment.paidOutAt
				? 'Cette consultation vous a déjà été versée : la banque retient le montant le temps de l’examen. Notre équipe suit le dossier.'
				: 'Son versement est suspendu le temps de l’examen. Notre équipe suit le dossier.',
		],
		details: [
			['Consultation', when],
			['Montant', amount],
			['Motif indiqué', reason],
		],
		link: `/appointment/${appointment.UUID}`,
		cta: 'Voir le rendez-vous',
		notes: [
			'Notre équipe pourra vous demander des justificatifs (la consultation a bien eu lieu, échanges avec le patient) : répondez-lui rapidement.',
			'Vous serez prévenu par email de l’issue de la contestation.',
		],
	});

	await Promise.all([
		notifyDoctor(strapi, doctor, {
			type: 'payments_alert',
			title: 'Un paiement est contesté',
			body: `Consultation du ${when} · ${amount}`,
			link: `/appointment/${appointment.UUID}`,
			dedupeKey: `payments_alert:dispute:${dispute.id}`,
			email: { subject: `Paiement contesté · consultation du ${when}`, html, text },
		}),
		notifyAdmins(strapi, {
			title: `Paiement contesté : ${amount}`,
			body: `${doctorLabel(doctor)} · consultation du ${when}`,
			link: `/admin/rendez-vous/${appointment.documentId}`,
			dedupeKey: `admin_payments:dispute:${dispute.id}`,
			email: adminEmail({
				title: `Paiement contesté : ${amount}`,
				paragraphs: [
					`Le patient conteste le paiement d’une consultation auprès de sa banque.${
						dueBy ? ` Les justificatifs doivent être envoyés avant le ${dueBy}, depuis le tableau de bord de paiement du compte du praticien.` : ''
					}`,
					appointment.paidOutAt
						? `Consultation déjà versée au praticien le ${dayOf(appointment.paidOutAt)} : le montant est retenu sur son compte de paiement.`
						: 'Versement de la consultation suspendu automatiquement jusqu’à l’issue de la contestation.',
				],
				details: [
					['Praticien', doctorLabel(doctor)],
					['Consultation', when],
					['Montant', amount],
					['Motif', reason],
					['Réponse avant le', dueBy],
					['Référence', dispute.id],
				],
				link: `/admin/rendez-vous/${appointment.documentId}`,
				cta: 'Voir le rendez-vous',
			}),
		}),
	]);
};

/** charge.dispute.closed : gagnée (versement débloqué) ou perdue (montant rendu au patient) */
const onDisputeClosed = async (strapi, dispute) => {
	const appointment = await disputedAppointment(strapi, dispute);
	if (!appointment) return;
	// warning_closed : simple demande d'information close sans contestation
	const won = dispute.status === 'won' || dispute.status === 'warning_closed';
	await strapi.db.query(APPOINTMENT).update({ where: { id: appointment.id }, data: { disputeStatus: won ? 'won' : 'lost' } });

	const doctor = appointment.doctor;
	const amount = euros(dispute.amount);
	const when = formatWhen(appointment.datetime);
	const title = won ? 'Contestation close en votre faveur' : 'Contestation perdue';
	const { html, text } = renderEmail({
		title,
		paragraphs: [
			hello(doctor),
			won
				? `La contestation du paiement de la consultation du ${when} (${amount}) est close en votre faveur. ${
						appointment.paidOutAt ? 'Le montant reste acquis.' : 'La consultation sera versée le lundi qui suit sa clôture.'
				  }`
				: `La banque a donné raison au titulaire de la carte : le paiement de la consultation du ${when} (${amount}) lui est rendu${
						appointment.paidOutAt ? ', et le montant est retenu sur votre compte de paiement' : ''
				  }.`,
		],
		link: `/appointment/${appointment.UUID}`,
		cta: 'Voir le rendez-vous',
		notes: won ? [] : ['Une question sur cette décision ? Contactez notre équipe depuis votre espace.'],
	});

	await Promise.all([
		notifyDoctor(strapi, doctor, {
			type: 'payments_alert',
			title,
			body: `Consultation du ${when} · ${amount}`,
			link: `/appointment/${appointment.UUID}`,
			dedupeKey: `payments_alert:dispute-closed:${dispute.id}`,
			email: { subject: `${title} · consultation du ${when}`, html, text },
		}),
		notifyAdmins(strapi, {
			title: `${won ? 'Contestation gagnée' : 'Contestation perdue'} : ${amount}`,
			body: `${doctorLabel(doctor)} · consultation du ${when}`,
			link: `/admin/rendez-vous/${appointment.documentId}`,
			dedupeKey: `admin_payments:dispute-closed:${dispute.id}`,
			email: adminEmail({
				title: `${won ? 'Contestation gagnée' : 'Contestation perdue'} : ${amount}`,
				paragraphs: [
					won
						? 'La contestation est close en faveur du praticien. Le versement de la consultation est débloqué.'
						: 'La contestation est perdue : le montant est rendu au patient. La consultation ne sera pas versée au praticien.',
				],
				details: [
					['Praticien', doctorLabel(doctor)],
					['Consultation', when],
					['Montant', amount],
					['Référence', dispute.id],
				],
				link: `/admin/rendez-vous/${appointment.documentId}`,
				cta: 'Voir le rendez-vous',
			}),
		}),
	]);
};

/* ------------------------------------------------------------------ */
/* Virements                                                           */
/* ------------------------------------------------------------------ */

/** payout.failed : la banque du praticien a refusé le virement */
const onPayoutFailed = async (strapi, payout, accountId) => {
	const doctor = await findDoctor(strapi, { stripeAccountId: accountId });
	if (!doctor) return;
	const amount = euros(payout.amount);
	const count = await strapi.db.query(APPOINTMENT).count({ where: { payoutId: payout.id } });

	const { html, text } = renderEmail({
		title: 'Votre virement n’a pas abouti',
		paragraphs: [
			hello(doctor),
			`Votre banque a refusé le virement de ${amount} du ${dayOf(payout.created)} : l’IBAN enregistré est sans doute incorrect, ou le compte est clôturé.`,
			'Vérifiez votre IBAN depuis votre page Paiements. Une fois corrigé, notre équipe relance le virement : le montant n’est pas perdu.',
		],
		details: [
			['Montant', amount],
			['Motif', payout.failure_message],
		],
		link: '/dashboard/paiements',
		cta: 'Vérifier mon IBAN',
	});

	await Promise.all([
		notifyDoctor(strapi, doctor, {
			type: 'payments_alert',
			title: 'Votre virement n’a pas abouti',
			body: `${amount} : vérifiez votre IBAN.`,
			link: '/dashboard/paiements',
			dedupeKey: `payments_alert:payout:${payout.id}`,
			email: { subject: `Virement refusé par votre banque · ${amount}`, html, text },
		}),
		notifyAdmins(strapi, {
			title: `Virement refusé : ${amount}`,
			body: doctorLabel(doctor),
			link: '/admin/paiements',
			dedupeKey: `admin_payments:payout:${payout.id}`,
			email: adminEmail({
				title: `Virement refusé : ${amount}`,
				paragraphs: [
					'La banque du praticien a refusé le virement du lundi. Le montant est revenu sur son compte de paiement. Le praticien a été invité à vérifier son IBAN.',
					`${count ? `${count > 1 ? `Les ${count} consultations` : 'La consultation'} de ce virement` : 'Les consultations de ce virement'} ${
						count === 1 ? 'reste marquée comme versée' : 'restent marquées comme versées'
					} : une fois l’IBAN corrigé, relancez le virement depuis le tableau de bord de paiement du compte du praticien.`,
				],
				details: [
					['Praticien', doctorLabel(doctor)],
					['Montant', amount],
					['Motif', payout.failure_message || payout.failure_code],
					['Référence', payout.id],
				],
				link: '/admin/paiements',
				cta: 'Voir les paiements',
			}),
		}),
	]);
};

/** Virement du lundi impossible (erreur à la création) : l'équipe est prévenue, nouvel essai lundi prochain */
const onMondayPayoutError = async (strapi, doctor, error, now = new Date()) => {
	const week = now.toISOString().slice(0, 10);
	await notifyAdmins(strapi, {
		title: `Virement du lundi impossible : ${doctorLabel(doctor)}`,
		body: String(error.message || error).slice(0, 200),
		link: '/admin/paiements',
		dedupeKey: `admin_payments:monday:${doctor.id}:${week}`,
		email: adminEmail({
			title: `Virement du lundi impossible : ${doctorLabel(doctor)}`,
			paragraphs: [
				'Le virement de cette semaine n’a pas pu être créé. Les consultations restent à verser : nouvel essai automatique lundi prochain.',
				'Causes fréquentes : IBAN manquant ou compte de paiement à compléter (le praticien en est prévenu par email), solde insuffisant.',
			],
			details: [
				['Praticien', doctorLabel(doctor)],
				['Erreur', String(error.message || error)],
			],
			link: '/admin/paiements',
			cta: 'Voir les paiements',
		}),
	});
};

module.exports = {
	onSubscriptionPaymentFailed,
	onTrialWillEnd,
	onSubscriptionEnded,
	onAccountUpdated,
	checkPaymentAccounts,
	checkAccount,
	onDisputeCreated,
	onDisputeClosed,
	onPayoutFailed,
	onMondayPayoutError,
};
