'use strict';

/**
 * Paiement des consultations (Stripe Connect)
 *
 * Stripe assume les risques (fraude, contestations) des comptes des praticiens : la consultation
 * est donc encaissée directement sur le compte Stripe du praticien (« paiement direct »), et
 * Meyana prélève COMMISSION_RATE au passage (frais de carte à la charge de Meyana).
 * - Versement : les virements du compte sont manuels. Chaque lundi, Meyana verse au praticien
 *   les consultations qu'il a clôturées (« Clôturer le rendez-vous » valide qu'elle a bien eu
 *   lieu ; jamais une consultation à venir, qui peut encore être annulée, remboursée ou
 *   contestée), dans la limite du solde disponible chez Stripe ; le reste est reporté au lundi
 *   suivant. Le récapitulatif part par email, avec les consultations passées à clôturer.
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

// Les virements sont déclenchés par Meyana (mondayPayouts), jamais automatiquement par Stripe
const MANUAL_PAYOUTS = { settings: { payouts: { schedule: { interval: 'manual' } } } };

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
	await stripe().accounts.update(account.id, MANUAL_PAYOUTS);
	return account.id;
};

/** État du compte relu chez Stripe ; paymentsEnabled = le compte peut encaisser */
const syncAccount = async (strapi, doctor) => {
	if (!doctor.stripeAccountId) return { ...doctor, account: null };
	let account = await stripe().accounts.retrieve(doctor.stripeAccountId);
	// Comptes créés avant les virements manuels : Stripe ne doit plus verser seul
	if (account.settings?.payouts?.schedule?.interval !== 'manual') {
		account = await stripe().accounts.update(doctor.stripeAccountId, MANUAL_PAYOUTS);
	}
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

const hasStarted = (appointment, now = new Date()) => new Date(appointment.datetime) <= now;

/**
 * Montant versable au praticien : consultation clôturée par lui, ou annulée trop tard par le
 * patient (le montant lui reste acquis) une fois la date passée.
 */
const isPayable = (appointment, now = new Date()) =>
	appointment.isCancelled ? hasStarted(appointment, now) : Boolean(appointment.isOver);

/** Répartit des consultations payées et pas encore versées : à verser, à clôturer, à venir */
const splitUnpaid = (appointments, now = new Date()) => ({
	due: appointments.filter((a) => isPayable(a, now)),
	toClose: appointments.filter((a) => !isPayable(a, now) && hasStarted(a, now)),
	upcoming: appointments.filter((a) => !hasStarted(a, now)),
});

const PAYOUT_FIELDS = ['id', 'UUID', 'datetime', 'price', 'isOver', 'isCancelled', 'paidOutAt', 'payoutId'];

/**
 * Virements du praticien (les plus récents d'abord), lus chez Stripe pour leur état et leur date
 * d'arrivée, avec les consultations que chacun contient.
 */
const payoutHistory = async (strapi, doctor, paid) => {
	if (!doctor.stripeAccountId) return [];
	let payouts;
	try {
		payouts = await stripe().payouts.list({ limit: 24 }, onAccount(doctor.stripeAccountId));
	} catch (error) {
		strapi.log.error(`Virements illisibles pour le praticien ${doctor.documentId} : ${error.message}`);
		return [];
	}
	const byPayout = new Map();
	for (const a of paid) {
		if (!a.payoutId) continue;
		if (!byPayout.has(a.payoutId)) byPayout.set(a.payoutId, []);
		byPayout.get(a.payoutId).push({ datetime: a.datetime, price: Number(a.price), net: netCents(a) / 100 });
	}
	return payouts.data.map((p) => ({
		id: p.id,
		createdAt: new Date(p.created * 1000).toISOString(),
		arrivalDate: p.arrival_date ? new Date(p.arrival_date * 1000).toISOString() : null,
		amount: p.amount / 100,
		// paid, pending, in_transit, canceled, failed
		status: p.status,
		appointments: byPayout.get(p.id) || [],
	}));
};

/** Page Paiements du praticien : état du compte, consultations à venir, à verser et versées, virements */
const accountSummary = async (strapi, user) => {
	let doctor = await doctorOfUser(strapi, user);
	if (!doctor) throw httpError(403, 'Réservé aux praticiens.');
	doctor = await syncAccount(strapi, doctor);

	const paid = await strapi.db.query(APPOINTMENT).findMany({
		where: { doctor: { id: doctor.id }, paymentStatus: 'paid' },
		select: PAYOUT_FIELDS,
		orderBy: { datetime: 'asc' },
		limit: 5000,
	});
	const { due, toClose, upcoming } = splitUnpaid(paid.filter((a) => !a.paidOutAt));
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
		due: totalsOf(due),
		toClose: {
			...totalsOf(toClose),
			appointments: toClose.slice(0, 20).map((a) => ({ uuid: a.UUID, datetime: a.datetime, net: netCents(a) / 100 })),
		},
		upcoming: totalsOf(upcoming),
		paidOut: totalsOf(paid.filter((a) => a.paidOutAt)),
		payouts: await payoutHistory(strapi, doctor, paid),
	};
};

/* ------------------------------------------------------------------ */
/* Versement du lundi                                                  */
/* ------------------------------------------------------------------ */

const euros = (value) =>
	`${Number(value).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

const netCents = (appointment) => cents(appointment.price) - commissionOf(cents(appointment.price));

/** Solde du compte disponible pour un virement (en centimes, euros uniquement) */
const availableCents = async (accountId) => {
	const balance = await stripe().balance.retrieve({}, onAccount(accountId));
	return (balance.available || []).filter((b) => b.currency === 'eur').reduce((s, b) => s + b.amount, 0);
};

/**
 * Verse à un praticien ses consultations clôturées et pas encore versées, des plus anciennes aux
 * plus récentes, tant que le solde disponible les couvre. Renvoie le détail pour l'email.
 */
const payOutDoctor = async (strapi, doctor, appointments, now) => {
	const { due, toClose, upcoming } = splitUnpaid(
		[...appointments].sort((a, b) => new Date(a.datetime) - new Date(b.datetime)),
		now
	);
	let available = due.length ? await availableCents(doctor.stripeAccountId) : 0;
	const paidOut = [];
	for (const a of due) {
		if (netCents(a) > available) break;
		available -= netCents(a);
		paidOut.push(a);
	}
	const amount = paidOut.reduce((s, a) => s + netCents(a), 0);
	if (amount > 0) {
		const payout = await stripe().payouts.create(
			{
				amount,
				currency: 'eur',
				description: 'Consultations Meyana',
				metadata: { doctorDocumentId: doctor.documentId, appointments: paidOut.length },
			},
			{ ...onAccount(doctor.stripeAccountId), idempotencyKey: `payout-${doctor.id}-${startOfWeek(now).toISOString().slice(0, 10)}` }
		);
		await strapi.db.query(APPOINTMENT).updateMany({
			where: { id: { $in: paidOut.map((a) => a.id) } },
			data: { paidOutAt: now, payoutId: payout.id },
		});
	}
	return { paidOut, carriedOver: due.slice(paidOut.length), toClose, upcoming };
};

const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;

/** Chaque lundi : virement des consultations clôturées et récapitulatif, par praticien */
const mondayPayouts = async (strapi) => {
	const now = new Date();
	const pending = await strapi.db.query(APPOINTMENT).findMany({
		where: { paymentStatus: 'paid', paidOutAt: { $null: true } },
		select: PAYOUT_FIELDS,
		populate: {
			doctor: {
				select: ['id', 'documentId', 'firstname', 'stripeAccountId'],
				populate: { users_permissions_user: { select: ['id'] } },
			},
		},
		limit: 5000,
	});
	const byDoctor = new Map();
	for (const a of pending) {
		if (!a.doctor?.stripeAccountId) continue;
		const row = byDoctor.get(a.doctor.id) ?? { doctor: a.doctor, appointments: [] };
		row.appointments.push(a);
		byDoctor.set(a.doctor.id, row);
	}
	for (const { doctor, appointments } of byDoctor.values()) {
		let result;
		try {
			result = await payOutDoctor(strapi, doctor, appointments, now);
		} catch (error) {
			// Compte incomplet (IBAN manquant…) : on réessaiera lundi prochain
			strapi.log.error(`Versement impossible pour le praticien ${doctor.documentId} : ${error.message}`);
			continue;
		}
		const { paidOut, carriedOver, toClose, upcoming } = result;
		if (!paidOut.length && !carriedOver.length && !toClose.length) continue;
		const t = totalsOf(paidOut);
		const notes = [];
		if (toClose.length) {
			notes.push(
				`${plural(toClose.length, 'consultation passée')} (${euros(totalsOf(toClose).net)}) ${toClose.length > 1 ? 'attendent' : 'attend'} votre clôture : ouvrez le rendez-vous et cliquez sur « Clôturer le rendez-vous » pour ${toClose.length > 1 ? 'qu’elles soient versées' : 'qu’elle soit versée'} lundi prochain.`
			);
		}
		if (carriedOver.length) {
			notes.push(
				`${plural(carriedOver.length, 'consultation clôturée')} (${euros(totalsOf(carriedOver).net)}) ${carriedOver.length > 1 ? 'seront versées' : 'sera versée'} lundi prochain, une fois les fonds disponibles chez notre prestataire de paiement.`
			);
		}
		if (upcoming.length) {
			notes.push(
				`${plural(upcoming.length, 'consultation à venir')} (${euros(totalsOf(upcoming).net)}) : versement le lundi qui suit sa clôture.`
			);
		}
		notes.push('Frais de paiement inclus dans la commission : rien d’autre n’est déduit.');
		await strapi.service('api::notification.notification').emailUser({
			recipient: doctor.users_permissions_user?.id,
			category: 'account',
			email: {
				subject: paidOut.length ? `Votre virement Meyana : ${euros(t.net)}` : 'Votre récapitulatif Meyana',
				...renderEmail({
					title: paidOut.length ? 'Votre virement de la semaine' : 'Le récapitulatif de votre semaine',
					paragraphs: [
						doctor.firstname ? `Bonjour ${doctor.firstname},` : 'Bonjour,',
						paidOut.length
							? `Nous venons de vous virer ${plural(paidOut.length, 'consultation')} ${paidOut.length > 1 ? 'clôturées' : 'clôturée'}. Le virement arrive sur votre compte bancaire sous 1 à 3 jours ouvrés.`
							: carriedOver.length
							? 'Aucun virement cette semaine : les fonds de vos consultations clôturées ne sont pas encore disponibles chez notre prestataire de paiement.'
							: 'Aucun virement cette semaine : vos consultations passées n’ont pas encore été clôturées.',
					],
					details: paidOut.length
						? [
								...paidOut.map((a) => [formatWhen(a.datetime), euros(a.price)]),
								['Total encaissé', euros(t.gross)],
								[`Commission Meyana (${COMMISSION_RATE * 100} %)`, `− ${euros(t.commission)}`],
								['Virement', euros(t.net)],
						  ]
						: [],
					notes,
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
	mondayPayouts,
	handlePaymentEvent,
};
