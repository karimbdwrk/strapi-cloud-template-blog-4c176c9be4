'use strict';

/**
 * Paiement des consultations (Stripe Connect)
 *
 * Stripe assume les risques (fraude, contestations) des comptes des praticiens : la consultation
 * est donc encaissée directement sur le compte Stripe du praticien (« paiement direct »), et
 * Meyana prélève COMMISSION_RATE au passage (frais de carte à la charge de Meyana).
 * Stripe verse le praticien chaque lundi ; Meyana lui envoie le récapitulatif de la semaine.
 *
 * - Compte du praticien : créé via l'API Accounts v2 avec un jeton (obligatoire pour une
 *   plateforme française), tableau de bord Express. Le praticien remplit ensuite le
 *   formulaire Stripe (identité, IBAN). Tant que son compte n'encaisse pas, ses patients
 *   réservent sans payer en ligne (règlement au cabinet).
 * - Réservation : le rendez-vous est créé « en attente de paiement » et bloque le créneau
 *   HOLD_MINUTES ; il n'est confirmé (notifications comprises) qu'une fois le paiement accepté.
 * - Annulation : remboursement intégral (commission comprise) si le praticien annule, ou si le
 *   patient annule au moins REFUND_NOTICE_HOURS avant. Sinon, le montant reste au praticien.
 *
 * Variable d'environnement : STRIPE_PUBLISHABLE_KEY (jeton de création des comptes).
 */

const { stripe, httpError } = require('./billing');
const { frontUrl, renderEmail } = require('./notifications/email');
const { formatWhen } = require('./notifications/helpers');

const APPOINTMENT = 'api::appointment.appointment';
const DOCTOR = 'api::doctor.doctor';
const COMMISSION_RATE = 0.05;
const HOLD_MINUTES = 20;
const REFUND_NOTICE_HOURS = 24;
const PAYMENT_METHOD_TYPES = ['card'];
// Version de l'API Accounts v2 (comptes Express dont Stripe assume les risques)
const ACCOUNTS_V2_VERSION = '2026-09-30.preview';

const PAYMENT_FIELDS = [
	'id',
	'documentId',
	'datetime',
	'isCancelled',
	'isCancelledByPatient',
	'price',
	'paymentStatus',
	'paymentIntentId',
	'paymentAccountId',
	'pendingUntil',
];
const ACCOUNT_FIELDS = ['id', 'documentId', 'firstname', 'lastname', 'UUID', 'isActive', 'stripeAccountId', 'paymentsEnabled'];

const cents = (euros) => Math.round(Number(euros) * 100);
const commissionOf = (amountCents) => Math.round(amountCents * COMMISSION_RATE);
const onAccount = (accountId) => ({ stripeAccount: accountId });

/* ------------------------------------------------------------------ */
/* Prix                                                                */
/* ------------------------------------------------------------------ */

/**
 * Montant payé en ligne : prix du motif choisi, sinon bas de la fourchette du praticien.
 * null si le praticien n'encaisse pas encore en ligne ou n'a pas de tarif (règlement au cabinet).
 */
const priceFor = (doctor, reasonTitle) => {
	if (!doctor.paymentsEnabled || !doctor.stripeAccountId) return null;
	const reason = (doctor.reason || []).find((r) => r.title === reasonTitle);
	const value = reason?.price ?? doctor.priceRange?.minimum;
	const amount = Number(value);
	return value !== null && value !== undefined && value !== '' && amount > 0 ? amount : null;
};

/** Champs ajoutés au rendez-vous créé par un patient : en attente de paiement */
const pendingPaymentData = (price, doctor) => ({
	price,
	paymentStatus: 'pending',
	paymentAccountId: doctor.stripeAccountId,
	pendingUntil: new Date(Date.now() + HOLD_MINUTES * 60000),
	isPaid: false,
});

/* ------------------------------------------------------------------ */
/* Paiement à la réservation                                           */
/* ------------------------------------------------------------------ */

/** Paiement du rendez-vous qui vient d'être créé → de quoi afficher le formulaire de carte */
const startPayment = async (strapi, appointment, { doctor, user }) => {
	const amount = cents(appointment.price);
	const intent = await stripe().paymentIntents.create(
		{
			amount,
			currency: 'eur',
			application_fee_amount: commissionOf(amount),
			payment_method_types: PAYMENT_METHOD_TYPES,
			description: `Consultation du ${formatWhen(appointment.datetime)}`,
			receipt_email: user.email || undefined,
			metadata: { appointmentDocumentId: appointment.documentId, doctorDocumentId: doctor.documentId },
		},
		{ ...onAccount(doctor.stripeAccountId), idempotencyKey: `meyana-appointment-${appointment.documentId}` }
	);
	await strapi.db.query(APPOINTMENT).update({ where: { id: appointment.id }, data: { paymentIntentId: intent.id } });
	return {
		clientSecret: intent.client_secret,
		// Le formulaire de carte doit viser le compte du praticien
		account: doctor.stripeAccountId,
		amount: Number(appointment.price),
		holdMinutes: HOLD_MINUTES,
	};
};

const retrieveIntent = (appointment) =>
	stripe().paymentIntents.retrieve(appointment.paymentIntentId, {}, onAccount(appointment.paymentAccountId));

const refund = (appointment, key) =>
	stripe().refunds.create(
		{
			payment_intent: appointment.paymentIntentId,
			refund_application_fee: true,
			metadata: { appointmentDocumentId: appointment.documentId },
		},
		{ ...onAccount(appointment.paymentAccountId), idempotencyKey: `meyana-${key}-${appointment.paymentIntentId}` }
	);

/**
 * Paiement accepté : le rendez-vous est confirmé (le passage pending → paid déclenche les
 * notifications de réservation). Payé trop tard, après annulation : remboursé aussitôt.
 */
const markPaid = async (strapi, appointment) => {
	if (!appointment || appointment.paymentStatus === 'paid' || appointment.paymentStatus === 'refunded') return appointment;
	if (appointment.isCancelled) {
		await refund(appointment, 'late-refund');
		await strapi.documents(APPOINTMENT).update({
			documentId: appointment.documentId,
			data: { paymentStatus: 'refunded', paidAt: new Date(), refundedAt: new Date() },
			silent: true,
		});
		return appointment;
	}
	await strapi.documents(APPOINTMENT).update({
		documentId: appointment.documentId,
		data: { paymentStatus: 'paid', isPaid: true, paidAt: new Date(), pendingUntil: null },
	});
	return { ...appointment, paymentStatus: 'paid' };
};

/** Le patient revient du formulaire : le paiement est relu chez Stripe (sans attendre le webhook) */
const confirmPayment = async (strapi, user, documentId) => {
	const appointment = await strapi.db.query(APPOINTMENT).findOne({
		where: { documentId, patient: { id: user.id } },
		select: PAYMENT_FIELDS,
	});
	if (!appointment?.paymentIntentId) throw httpError(404, 'Rendez-vous introuvable.');
	const intent = await retrieveIntent(appointment);
	if (intent.status !== 'succeeded') throw httpError(402, 'Le paiement n’a pas encore été accepté.');
	await markPaid(strapi, appointment);
	return { paymentStatus: 'paid' };
};

/** Rendez-vous en attente abandonné (fenêtre fermée, délai dépassé) : créneau libéré sans notification */
const releasePending = async (strapi, appointment) => {
	if (appointment.paymentIntentId) {
		const intent = await retrieveIntent(appointment);
		// Payé entre-temps (navigateur fermé juste après le paiement) : on garde le rendez-vous
		if (intent.status === 'succeeded') return markPaid(strapi, appointment);
		if (intent.status === 'processing') return null;
		if (intent.status !== 'canceled') {
			await stripe().paymentIntents.cancel(intent.id, {}, onAccount(appointment.paymentAccountId));
		}
	}
	await strapi.documents(APPOINTMENT).update({
		documentId: appointment.documentId,
		data: { isCancelled: true, paymentStatus: 'none', pendingUntil: null },
		silent: true,
	});
	return null;
};

/** POST /appointments/:id/abandon : le patient ferme le paiement sans payer */
const abandonPayment = async (strapi, user, documentId) => {
	const appointment = await strapi.db.query(APPOINTMENT).findOne({
		where: { documentId, patient: { id: user.id }, paymentStatus: 'pending' },
		select: PAYMENT_FIELDS,
	});
	if (appointment) await releasePending(strapi, appointment);
};

/** Tâche planifiée : réservations non payées à temps (ou payées sans retour du navigateur) */
const expirePending = async (strapi) => {
	const expired = await strapi.db.query(APPOINTMENT).findMany({
		where: { paymentStatus: 'pending', pendingUntil: { $lt: new Date() } },
		select: PAYMENT_FIELDS,
		limit: 200,
	});
	for (const appointment of expired) {
		try {
			await releasePending(strapi, appointment);
		} catch (error) {
			strapi.log.error(`Paiements : réservation ${appointment.documentId} non libérée (${error.message})`);
		}
	}
};

/* ------------------------------------------------------------------ */
/* Annulation                                                          */
/* ------------------------------------------------------------------ */

/**
 * Avant l'annulation d'un rendez-vous : remboursement si le praticien (ou l'admin) annule, ou si
 * le patient annule au moins 24 h avant. Renvoie les champs à enregistrer avec l'annulation.
 */
const refundOnCancel = async (strapi, documentId, { byPatient }) => {
	const appointment = await strapi.db.query(APPOINTMENT).findOne({ where: { documentId }, select: PAYMENT_FIELDS });
	if (!appointment || appointment.isCancelled || !appointment.paymentIntentId) return {};

	// Pas encore payé : le paiement en cours est abandonné (ou remboursé s'il vient d'aboutir)
	if (appointment.paymentStatus === 'pending') {
		const intent = await retrieveIntent(appointment);
		if (intent.status === 'succeeded') {
			await refund(appointment, 'refund');
			return { paymentStatus: 'refunded', refundedAt: new Date(), pendingUntil: null };
		}
		if (!['canceled', 'processing'].includes(intent.status)) {
			await stripe().paymentIntents.cancel(intent.id, {}, onAccount(appointment.paymentAccountId));
		}
		return { paymentStatus: 'none', pendingUntil: null };
	}
	if (appointment.paymentStatus !== 'paid') return {};

	const hoursBefore = (new Date(appointment.datetime).getTime() - Date.now()) / 3600000;
	if (byPatient && hoursBefore < REFUND_NOTICE_HOURS) return {};
	await refund(appointment, 'refund');
	return { paymentStatus: 'refunded', refundedAt: new Date(), isPaid: false };
};

/* ------------------------------------------------------------------ */
/* Compte de paiement du praticien                                     */
/* ------------------------------------------------------------------ */

const doctorOfUser = (strapi, user) =>
	strapi.db.query(DOCTOR).findOne({ where: { users_permissions_user: { id: user.id } }, select: ACCOUNT_FIELDS });

/** Appel de l'API Stripe v2 (comptes) */
const stripeV2 = async (path, body, key) => {
	const response = await fetch(`https://api.stripe.com${path}`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${key}`,
			'Stripe-Version': ACCOUNTS_V2_VERSION,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(body),
	});
	const data = await response.json();
	if (!response.ok) throw new Error(data?.error?.message || `Stripe ${response.status}`);
	return data;
};

/**
 * Compte Express du praticien. Plateforme française : les informations du compte passent par
 * un jeton créé avec la clé publiable ; l'identité et l'IBAN sont saisis par le praticien chez Stripe.
 */
const createAccount = async (doctor, user) => {
	if (!process.env.STRIPE_PUBLISHABLE_KEY) throw httpError(503, 'Paiement non configuré.');
	const token = await stripeV2('/v2/core/account_tokens', { contact_email: user.email }, process.env.STRIPE_PUBLISHABLE_KEY);
	const account = await stripeV2(
		'/v2/core/accounts',
		{
			account_token: token.id,
			identity: { country: 'FR' },
			dashboard: 'express',
			defaults: {
				currency: 'eur',
				locales: ['fr-FR'],
				responsibilities: { fees_collector: 'application', losses_collector: 'stripe' },
			},
			configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
			metadata: { doctorDocumentId: doctor.documentId },
		},
		process.env.STRIPE_SECRET_KEY
	);
	// Versement automatique chaque lundi
	await stripe().accounts.update(account.id, {
		settings: { payouts: { schedule: { interval: 'weekly', weekly_anchor: 'monday' } } },
	});
	return account.id;
};

/** État du compte relu chez Stripe ; paymentsEnabled = le compte peut encaisser */
const syncAccount = async (strapi, doctor) => {
	if (!doctor.stripeAccountId) return { ...doctor, account: null };
	const account = await stripe().accounts.retrieve(doctor.stripeAccountId);
	const paymentsEnabled = Boolean(account.charges_enabled);
	if (paymentsEnabled !== Boolean(doctor.paymentsEnabled)) {
		await strapi.db.query(DOCTOR).update({ where: { id: doctor.id }, data: { paymentsEnabled } });
	}
	return { ...doctor, paymentsEnabled, account };
};

/** Lien vers le formulaire Stripe (identité, IBAN) ; le compte est créé au premier passage */
const onboardingLink = async (strapi, user, returnPath = '/dashboard/paiements') => {
	let doctor = await doctorOfUser(strapi, user);
	if (!doctor) throw httpError(403, 'Réservé aux praticiens.');
	if (!doctor.stripeAccountId) {
		const stripeAccountId = await createAccount(doctor, user);
		await strapi.db.query(DOCTOR).update({ where: { id: doctor.id }, data: { stripeAccountId } });
		doctor = { ...doctor, stripeAccountId };
	}
	const path = ['/dashboard/paiements', '/onboarding'].includes(returnPath) ? returnPath : '/dashboard/paiements';
	const link = await stripe().accountLinks.create({
		account: doctor.stripeAccountId,
		type: 'account_onboarding',
		refresh_url: `${frontUrl()}${path}?compte=relancer`,
		return_url: `${frontUrl()}${path}?compte=retour`,
	});
	return link.url;
};

/** Tableau de bord Stripe Express du praticien (paiements reçus, virements, IBAN) */
const dashboardLink = async (strapi, user) => {
	const doctor = await doctorOfUser(strapi, user);
	if (!doctor?.stripeAccountId) throw httpError(400, 'Aucun compte de paiement.');
	return (await stripe().accounts.createLoginLink(doctor.stripeAccountId)).url;
};

/** Résumé d'un ensemble de consultations payées */
const totalsOf = (appointments) => {
	const gross = appointments.reduce((s, a) => s + cents(a.price), 0);
	const fee = appointments.reduce((s, a) => s + commissionOf(cents(a.price)), 0);
	return { count: appointments.length, gross: gross / 100, commission: fee / 100, net: (gross - fee) / 100 };
};

const startOfWeek = (date = new Date()) => {
	// Lundi 00:00, heure de Paris (approximation UTC suffisante pour un récapitulatif)
	const d = new Date(date);
	const day = (d.getUTCDay() + 6) % 7;
	d.setUTCHours(0, 0, 0, 0);
	d.setUTCDate(d.getUTCDate() - day);
	return d;
};

/** Page Paiements du praticien : état du compte et consultations payées en ligne */
const accountSummary = async (strapi, user) => {
	let doctor = await doctorOfUser(strapi, user);
	if (!doctor) throw httpError(403, 'Réservé aux praticiens.');
	doctor = await syncAccount(strapi, doctor);

	const paid = await strapi.db.query(APPOINTMENT).findMany({
		where: { doctor: { id: doctor.id }, paymentStatus: 'paid' },
		select: ['price', 'paidAt'],
		limit: 2000,
	});
	const thisWeek = startOfWeek();
	const lastWeek = new Date(thisWeek.getTime() - 7 * 86400000);
	const between = (from, to) => paid.filter((a) => a.paidAt && new Date(a.paidAt) >= from && (!to || new Date(a.paidAt) < to));
	const requirements = doctor.account?.requirements || {};
	return {
		account: {
			created: Boolean(doctor.stripeAccountId),
			paymentsEnabled: Boolean(doctor.paymentsEnabled),
			payoutsEnabled: Boolean(doctor.account?.payouts_enabled),
			detailsSubmitted: Boolean(doctor.account?.details_submitted),
			actionRequired: (requirements.currently_due || []).length > 0 || (requirements.past_due || []).length > 0,
		},
		commissionRate: COMMISSION_RATE,
		thisWeek: totalsOf(between(thisWeek)),
		lastWeek: totalsOf(between(lastWeek, thisWeek)),
		total: totalsOf(paid),
	};
};

/* ------------------------------------------------------------------ */
/* Récapitulatif du lundi                                              */
/* ------------------------------------------------------------------ */

const euros = (value) =>
	`${Number(value).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

/** Chaque lundi : consultations payées en ligne la semaine passée, par praticien */
const weeklyRecap = async (strapi) => {
	const to = startOfWeek();
	const from = new Date(to.getTime() - 7 * 86400000);
	const paid = await strapi.db.query(APPOINTMENT).findMany({
		where: { paymentStatus: 'paid', paidAt: { $gte: from, $lt: to } },
		select: ['datetime', 'price'],
		populate: { doctor: { select: ['id', 'firstname'], populate: { users_permissions_user: { select: ['id'] } } } },
		orderBy: { datetime: 'asc' },
		limit: 5000,
	});
	const byDoctor = new Map();
	for (const a of paid) {
		if (!a.doctor) continue;
		const row = byDoctor.get(a.doctor.id) ?? { doctor: a.doctor, appointments: [] };
		row.appointments.push(a);
		byDoctor.set(a.doctor.id, row);
	}
	for (const { doctor, appointments } of byDoctor.values()) {
		const t = totalsOf(appointments);
		await strapi.service('api::notification.notification').emailUser({
			recipient: doctor.users_permissions_user?.id,
			category: 'account',
			email: {
				subject: `Votre semaine sur Meyana : ${euros(t.net)}`,
				...renderEmail({
					title: 'Le récapitulatif de votre semaine',
					paragraphs: [
						doctor.firstname ? `Bonjour ${doctor.firstname},` : 'Bonjour,',
						`${t.count} consultation${t.count > 1 ? 's' : ''} payée${t.count > 1 ? 's' : ''} en ligne la semaine dernière. Les montants sont versés sur votre compte bancaire chaque lundi, dès qu’ils sont disponibles chez notre prestataire de paiement.`,
					],
					details: [
						...appointments.map((a) => [formatWhen(a.datetime), euros(a.price)]),
						['Total encaissé', euros(t.gross)],
						[`Commission Meyana (${COMMISSION_RATE * 100} %)`, `− ${euros(t.commission)}`],
						['Pour vous', euros(t.net)],
					],
					notes: ['Frais de paiement inclus dans la commission : rien d’autre n’est déduit.'],
					link: '/dashboard/paiements',
					cta: 'Voir mes paiements',
				}),
			},
		});
	}
};

/** Webhook (événements des comptes des praticiens) : paiement d'une consultation */
const handlePaymentEvent = async (strapi, event) => {
	const intent = event.data.object;
	if (event.type !== 'payment_intent.succeeded' || !intent.metadata?.appointmentDocumentId) return;
	const appointment = await strapi.db.query(APPOINTMENT).findOne({
		where: { paymentIntentId: intent.id },
		select: PAYMENT_FIELDS,
	});
	await markPaid(strapi, appointment);
};

module.exports = {
	COMMISSION_RATE,
	HOLD_MINUTES,
	priceFor,
	pendingPaymentData,
	startPayment,
	confirmPayment,
	abandonPayment,
	expirePending,
	refundOnCancel,
	syncAccount,
	onboardingLink,
	dashboardLink,
	accountSummary,
	weeklyRecap,
	handlePaymentEvent,
};
