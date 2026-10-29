'use strict';

/**
 * Abonnement des praticiens (Stripe)
 *
 * - Essentiel : gratuit, rendez-vous par téléphone uniquement.
 * - Premium   : 59 €/mois, ou 49 €/mois payé à l'année (588 €). Agenda et paiement en ligne.
 *               Un mois d'essai offert à la première souscription.
 * - L'admin peut offrir des mois de Premium : prolongation de l'essai si le praticien est déjà
 *   abonné, sinon accès Premium sans abonnement jusqu'à une date (`offeredUntil`).
 *
 * `doctor.plan` (public) est recalculé à chaque changement : c'est lui que lit le site.
 *
 * Le praticien paie dans la page Abonnement de Meyana : seuls les champs de carte sont
 * fournis par Stripe (voir prepareSubscription).
 *
 * Variables d'environnement :
 *   STRIPE_SECRET_KEY      clé secrète (sans elle, l'abonnement est désactivé)
 *   STRIPE_WEBHOOK_SECRET  secret de signature des webhooks (whsec_…)
 *   STRIPE_CONNECT_WEBHOOK_SECRET  (facultatif) secret du webhook des comptes des praticiens
 */

const Stripe = require('stripe');
const { frontUrl } = require('./notifications/email');

const DOCTOR = 'api::doctor.doctor';
const TRIAL_DAYS = 30;
// Statuts Stripe qui donnent accès à Premium (past_due : le temps de régulariser la carte)
const PREMIUM_STATUSES = ['trialing', 'active', 'past_due'];

// Catalogue créé dans Stripe au démarrage s'il manque (retrouvé par identifiant et lookup_key)
const PRODUCT = { id: 'meyana_premium', name: 'Meyana Premium' };
const PRICES = {
	month: { lookup_key: 'premium_monthly', unit_amount: 5900, interval: 'month', monthly: 59 },
	year: { lookup_key: 'premium_yearly', unit_amount: 58800, interval: 'year', monthly: 49 },
};

const DOCTOR_FIELDS = [
	'id',
	'documentId',
	'firstname',
	'lastname',
	'isActive',
	'plan',
	'offeredUntil',
	'trialUsed',
	'stripeCustomerId',
	'stripeSubscriptionId',
	'subscriptionStatus',
	'subscriptionInterval',
	'subscriptionPeriodEnd',
	'subscriptionCancelAtPeriodEnd',
];

let client = null;
const stripe = () => {
	if (!process.env.STRIPE_SECRET_KEY) throw Object.assign(new Error('Paiement non configuré'), { status: 503 });
	client ??= new Stripe(process.env.STRIPE_SECRET_KEY, { appInfo: { name: 'Meyana' } });
	return client;
};

const enabled = () => Boolean(process.env.STRIPE_SECRET_KEY);

/* ------------------------------------------------------------------ */
/* Catalogue et portail client                                         */
/* ------------------------------------------------------------------ */

const priceIds = {};
let portalConfigId = null;

const ensureCatalog = async () => {
	const s = stripe();
	try {
		await s.products.retrieve(PRODUCT.id);
	} catch (error) {
		if (error.code !== 'resource_missing') throw error;
		await s.products.create({ id: PRODUCT.id, name: PRODUCT.name });
	}
	const { data } = await s.prices.list({
		lookup_keys: Object.values(PRICES).map((p) => p.lookup_key),
		active: true,
	});
	for (const [interval, price] of Object.entries(PRICES)) {
		const found = data.find((p) => p.lookup_key === price.lookup_key);
		priceIds[interval] =
			found?.id ??
			(
				await s.prices.create({
					product: PRODUCT.id,
					currency: 'eur',
					unit_amount: price.unit_amount,
					recurring: { interval: price.interval },
					lookup_key: price.lookup_key,
					tax_behavior: 'inclusive',
				})
			).id;
	}

	// Portail : factures, carte bancaire, passage mensuel ↔ annuel, résiliation en fin de période
	const configs = await s.billingPortal.configurations.list({ active: true, limit: 100 });
	const existing = configs.data.find((c) => c.metadata?.meyana === 'premium');
	const config = {
		business_profile: { headline: 'Meyana : votre abonnement praticien' },
		features: {
			invoice_history: { enabled: true },
			payment_method_update: { enabled: true },
			customer_update: { enabled: true, allowed_updates: ['email', 'address', 'name', 'tax_id'] },
			subscription_cancel: { enabled: true, mode: 'at_period_end' },
			subscription_update: {
				enabled: true,
				default_allowed_updates: ['price'],
				proration_behavior: 'none',
				products: [{ product: PRODUCT.id, prices: Object.values(priceIds) }],
			},
		},
		metadata: { meyana: 'premium' },
	};
	portalConfigId = existing
		? (await s.billingPortal.configurations.update(existing.id, config)).id
		: (await s.billingPortal.configurations.create(config)).id;
};

/** Au démarrage : catalogue prêt, sans bloquer Strapi si Stripe ne répond pas */
const setupBilling = async (strapi) => {
	if (!enabled()) {
		strapi.log.warn('Abonnements : STRIPE_SECRET_KEY absente, paiement désactivé.');
		return;
	}
	try {
		await ensureCatalog();
	} catch (error) {
		strapi.log.error(`Abonnements : catalogue Stripe non initialisé (${error.message})`);
	}
};

const readyCatalog = async () => {
	if (!priceIds.month || !priceIds.year || !portalConfigId) await ensureCatalog();
};

/* ------------------------------------------------------------------ */
/* Praticien                                                           */
/* ------------------------------------------------------------------ */

const isFuture = (date, marginMs = 0) => Boolean(date) && new Date(date).getTime() > Date.now() + marginMs;

const planOf = (doctor) =>
	PREMIUM_STATUSES.includes(doctor.subscriptionStatus) || isFuture(doctor.offeredUntil) ? 'premium' : 'essentiel';

const findDoctor = (strapi, where) => strapi.db.query(DOCTOR).findOne({ where, select: DOCTOR_FIELDS });

const doctorOfUser = (strapi, user) => findDoctor(strapi, { users_permissions_user: { id: user.id } });

/** Enregistre les champs d'abonnement et recalcule le plan */
const saveDoctor = async (strapi, doctor, patch) => {
	const next = { ...doctor, ...patch };
	const data = { ...patch, plan: planOf(next) };
	await strapi.db.query(DOCTOR).update({ where: { id: doctor.id }, data });
	return { ...next, plan: data.plan };
};

const addMonths = (from, months) => {
	const date = new Date(from);
	const day = date.getDate();
	date.setMonth(date.getMonth() + months);
	// 31 janvier + 1 mois : fin février plutôt que début mars
	if (date.getDate() < day) date.setDate(0);
	return date;
};

/** Ce que voit le praticien (et l'admin) de son abonnement */
const summary = (doctor) => ({
	plan: doctor.plan || 'essentiel',
	status: doctor.subscriptionStatus || null,
	interval: doctor.subscriptionInterval || null,
	periodEnd: doctor.subscriptionPeriodEnd || null,
	cancelAtPeriodEnd: Boolean(doctor.subscriptionCancelAtPeriodEnd),
	offeredUntil: isFuture(doctor.offeredUntil) ? doctor.offeredUntil : null,
	trialAvailable: !doctor.trialUsed,
	trialDays: TRIAL_DAYS,
	hasBillingAccount: Boolean(doctor.stripeCustomerId),
	prices: { month: PRICES.month.monthly, year: PRICES.year.monthly },
	enabled: enabled(),
});

/* ------------------------------------------------------------------ */
/* Synchronisation depuis Stripe                                       */
/* ------------------------------------------------------------------ */

/** Fin de la période en cours (champ porté par l'article depuis l'API 2025-03) */
const periodEndOf = (subscription) => {
	const item = subscription.items?.data?.[0];
	const end = item?.current_period_end ?? subscription.current_period_end ?? subscription.trial_end;
	return end ? new Date(end * 1000) : null;
};

const syncSubscription = async (strapi, subscription) => {
	const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id;
	const doctor =
		(subscription.metadata?.doctorDocumentId &&
			(await findDoctor(strapi, { documentId: subscription.metadata.doctorDocumentId }))) ||
		(customerId && (await findDoctor(strapi, { stripeCustomerId: customerId })));
	if (!doctor) {
		strapi.log.warn(`Abonnements : aucun praticien pour l'abonnement ${subscription.id}`);
		return null;
	}
	// Un ancien abonnement résilié ne doit pas écraser l'abonnement en cours
	if (
		doctor.stripeSubscriptionId &&
		doctor.stripeSubscriptionId !== subscription.id &&
		PREMIUM_STATUSES.includes(doctor.subscriptionStatus) &&
		!PREMIUM_STATUSES.includes(subscription.status)
	) {
		return doctor;
	}
	return saveDoctor(strapi, doctor, {
		stripeCustomerId: customerId || doctor.stripeCustomerId,
		stripeSubscriptionId: subscription.id,
		subscriptionStatus: subscription.status,
		subscriptionInterval: subscription.items?.data?.[0]?.price?.recurring?.interval ?? null,
		subscriptionPeriodEnd: periodEndOf(subscription),
		subscriptionCancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end || subscription.cancel_at),
		trialUsed: doctor.trialUsed || Boolean(subscription.trial_start),
	});
};

/** Relit les abonnements du praticien chez Stripe (retour du paiement, filet si un webhook manque) */
const syncDoctor = async (strapi, doctor) => {
	if (!doctor.stripeCustomerId) return doctor;
	const { data } = await stripe().subscriptions.list({ customer: doctor.stripeCustomerId, status: 'all', limit: 10 });
	if (!data.length) return doctor;
	const current = data.find((s) => PREMIUM_STATUSES.includes(s.status)) ?? data[0];
	return (await syncSubscription(strapi, current)) ?? doctor;
};

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

const httpError = (status, message) => Object.assign(new Error(message), { status, expose: true });

const ensureCustomer = async (strapi, doctor, user) => {
	if (doctor.stripeCustomerId) return doctor;
	const customer = await stripe().customers.create({
		email: user.email,
		name: [doctor.firstname, doctor.lastname].filter(Boolean).join(' ') || undefined,
		preferred_locales: ['fr'],
		metadata: { doctorDocumentId: doctor.documentId },
	});
	return saveDoctor(strapi, doctor, { stripeCustomerId: customer.id });
};

// Paiement par carte uniquement (formulaire Meyana, champs de carte fournis par Stripe)
const PAYMENT_METHOD_TYPES = ['card'];

/** Mois offerts par l'admin : la facturation commence à leur fin ; sinon, mois d'essai s'il n'a pas servi */
const trialOf = (doctor) => {
	if (isFuture(doctor.offeredUntil, 48 * 3600 * 1000)) {
		return { trial_end: Math.floor(new Date(doctor.offeredUntil).getTime() / 1000) };
	}
	if (!doctor.trialUsed) return { trial_period_days: TRIAL_DAYS };
	return null;
};

/** Praticien prêt à souscrire : catalogue chargé, pas d'abonnement en cours, client Stripe créé */
const subscribableDoctor = async (strapi, user) => {
	let doctor = await doctorOfUser(strapi, user);
	if (!doctor) throw httpError(403, 'Réservé aux praticiens.');
	if (!doctor.isActive) throw httpError(403, 'Votre profil doit être validé avant de souscrire.');
	await readyCatalog();
	doctor = await syncDoctor(strapi, doctor);
	if (PREMIUM_STATUSES.includes(doctor.subscriptionStatus)) {
		throw httpError(409, 'Vous avez déjà un abonnement Premium.');
	}
	return ensureCustomer(strapi, doctor, user);
};

/** Tentatives de paiement abandonnées : un seul abonnement en attente à la fois */
const cancelIncomplete = async (customerId) => {
	const { data } = await stripe().subscriptions.list({ customer: customerId, status: 'incomplete', limit: 10 });
	for (const subscription of data) await stripe().subscriptions.cancel(subscription.id);
};

/**
 * Prépare le formulaire de paiement de la page Abonnement.
 * - Avec essai (ou mois offerts) : enregistrement de la carte seul, l'abonnement est créé
 *   ensuite par `confirmTrialSubscription` (abandonner le formulaire ne donne pas d'essai).
 * - Sans essai : abonnement en attente du premier paiement, confirmé par le formulaire.
 * Renvoie { mode: 'setup' | 'payment', clientSecret }.
 */
const prepareSubscription = async (strapi, user, interval) => {
	if (!PRICES[interval]) throw httpError(400, 'Formule inconnue.');
	const doctor = await subscribableDoctor(strapi, user);
	await cancelIncomplete(doctor.stripeCustomerId);

	if (trialOf(doctor)) {
		const setupIntent = await stripe().setupIntents.create({
			customer: doctor.stripeCustomerId,
			usage: 'off_session',
			payment_method_types: PAYMENT_METHOD_TYPES,
			metadata: { doctorDocumentId: doctor.documentId, interval },
		});
		return { mode: 'setup', clientSecret: setupIntent.client_secret };
	}

	const subscription = await stripe().subscriptions.create({
		customer: doctor.stripeCustomerId,
		items: [{ price: priceIds[interval] }],
		payment_behavior: 'default_incomplete',
		payment_settings: {
			save_default_payment_method: 'on_subscription',
			payment_method_types: PAYMENT_METHOD_TYPES,
		},
		metadata: { doctorDocumentId: doctor.documentId },
		expand: ['latest_invoice.confirmation_secret'],
	});
	return { mode: 'payment', clientSecret: subscription.latest_invoice.confirmation_secret.client_secret };
};

/** Carte enregistrée (essai ou mois offerts) : création de l'abonnement, sans débit immédiat */
const confirmTrialSubscription = async (strapi, user, setupIntentId) => {
	if (typeof setupIntentId !== 'string' || !setupIntentId.startsWith('seti_')) {
		throw httpError(400, 'Enregistrement de carte inconnu.');
	}
	let doctor = await doctorOfUser(strapi, user);
	if (!doctor) throw httpError(403, 'Réservé aux praticiens.');
	doctor = await syncDoctor(strapi, doctor);
	// Double envoi (retour de validation bancaire, double clic) : déjà fait
	if (PREMIUM_STATUSES.includes(doctor.subscriptionStatus)) return doctor;

	const setupIntent = await stripe().setupIntents.retrieve(setupIntentId);
	if (setupIntent.customer !== doctor.stripeCustomerId) throw httpError(403, 'Enregistrement de carte inconnu.');
	if (setupIntent.status !== 'succeeded') throw httpError(402, 'La carte n’a pas été validée.');
	const interval = PRICES[setupIntent.metadata?.interval] ? setupIntent.metadata.interval : 'month';
	await readyCatalog();

	const paymentMethod = setupIntent.payment_method;
	await stripe().customers.update(doctor.stripeCustomerId, {
		invoice_settings: { default_payment_method: paymentMethod },
	});
	const trial = trialOf(doctor);
	const subscription = await stripe().subscriptions.create(
		{
			customer: doctor.stripeCustomerId,
			items: [{ price: priceIds[interval] }],
			default_payment_method: paymentMethod,
			...(trial ?? {}),
			...(trial && { trial_settings: { end_behavior: { missing_payment_method: 'cancel' } } }),
			payment_settings: { payment_method_types: PAYMENT_METHOD_TYPES },
			metadata: { doctorDocumentId: doctor.documentId },
		},
		{ idempotencyKey: `meyana-subscription-${setupIntentId}` }
	);
	return (await syncSubscription(strapi, subscription)) ?? doctor;
};

/** Portail Stripe : carte, factures, changement de formule, résiliation */
const createPortal = async (strapi, user) => {
	const doctor = await doctorOfUser(strapi, user);
	if (!doctor) throw httpError(403, 'Réservé aux praticiens.');
	if (!doctor.stripeCustomerId) throw httpError(400, 'Aucun abonnement à gérer.');
	await readyCatalog();
	const session = await stripe().billingPortal.sessions.create({
		customer: doctor.stripeCustomerId,
		configuration: portalConfigId,
		locale: 'fr',
		return_url: `${frontUrl()}/dashboard/abonnement`,
	});
	return session.url;
};

/**
 * Offre `months` mois de Premium.
 * Abonné : la prochaine facturation est repoussée (essai prolongé, sans prorata).
 * Non abonné : Premium jusqu'à la date, la facturation commencera à cette date s'il souscrit.
 */
const offerMonths = async (strapi, doctor, months) => {
	const subscribed = doctor.stripeSubscriptionId && PREMIUM_STATUSES.includes(doctor.subscriptionStatus);
	const from = [Date.now(), doctor.offeredUntil, subscribed && doctor.subscriptionPeriodEnd]
		.filter(Boolean)
		.map((d) => new Date(d).getTime())
		.reduce((a, b) => Math.max(a, b));
	const until = addMonths(from, months);

	if (subscribed) {
		const subscription = await stripe().subscriptions.update(doctor.stripeSubscriptionId, {
			trial_end: Math.floor(until.getTime() / 1000),
			proration_behavior: 'none',
		});
		doctor = (await syncSubscription(strapi, subscription)) ?? doctor;
	}
	return saveDoctor(strapi, doctor, { offeredUntil: until });
};

/** Mois offerts expirés : le plan repasse à Essentiel (tâche quotidienne) */
const expireOffers = async (strapi) => {
	const doctors = await strapi.db.query(DOCTOR).findMany({
		where: { plan: 'premium', offeredUntil: { $lt: new Date() } },
		select: DOCTOR_FIELDS,
	});
	for (const doctor of doctors) {
		if (planOf(doctor) !== doctor.plan) await saveDoctor(strapi, doctor, {});
	}
};

/** Webhook Stripe : corps brut vérifié avec STRIPE_WEBHOOK_SECRET */
const handleWebhook = async (strapi, rawBody, signature) => {
	// Deux destinations possibles chez Stripe : le compte Meyana et les comptes des praticiens
	const secrets = [process.env.STRIPE_WEBHOOK_SECRET, process.env.STRIPE_CONNECT_WEBHOOK_SECRET].filter(Boolean);
	if (!secrets.length) throw httpError(503, 'Webhook non configuré.');
	let event;
	let lastError;
	for (const secret of secrets) {
		try {
			event = stripe().webhooks.constructEvent(rawBody, signature, secret);
			break;
		} catch (error) {
			lastError = error;
		}
	}
	if (!event) throw httpError(400, `Signature invalide (${lastError.message})`);
	const object = event.data.object;
	switch (event.type) {
		case 'customer.subscription.created':
		case 'customer.subscription.updated':
		case 'customer.subscription.deleted':
		case 'customer.subscription.trial_will_end':
			await syncSubscription(strapi, object);
			break;
		case 'checkout.session.completed':
			if (object.mode === 'subscription' && object.subscription) {
				await syncSubscription(strapi, await stripe().subscriptions.retrieve(object.subscription));
			}
			break;
		case 'payment_intent.succeeded':
			// Paiement d'une consultation (chargé ici : payments.js dépend de ce module)
			await require('./payments').handlePaymentEvent(strapi, event);
			break;
		case 'invoice.paid':
		case 'invoice.payment_failed': {
			const id = object.parent?.subscription_details?.subscription ?? object.subscription;
			if (id) await syncSubscription(strapi, await stripe().subscriptions.retrieve(id));
			break;
		}
		default:
			break;
	}
};

module.exports = {
	stripe,
	httpError,
	DOCTOR_FIELDS,
	setupBilling,
	summary,
	findDoctor,
	doctorOfUser,
	syncDoctor,
	prepareSubscription,
	confirmTrialSubscription,
	createPortal,
	offerMonths,
	expireOffers,
	handleWebhook,
	planOf,
};
