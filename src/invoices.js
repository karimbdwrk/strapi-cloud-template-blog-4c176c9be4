'use strict';

/**
 * Factures (numérotées et hébergées par Stripe, consultables en ligne et en PDF)
 *
 * - Abonnement : facture Meyana → praticien, générée par Stripe Billing à chaque échéance.
 * - Consultation : facture praticien → patient, établie par Meyana au nom et pour le compte du
 *   praticien (mandat de facturation, voir les CGU), sur le compte Stripe du praticien : sa
 *   numérotation lui est propre et le paiement du patient y est rattaché. Remboursement → avoir.
 * - Commission : facture Meyana → praticien à chaque virement du lundi, pour la commission
 *   retenue sur les consultations versées.
 *
 * Le PDF Stripe garde la mention « à régler » : chaque facture porte donc une ligne
 * « Acquittée » (date et moyen de paiement), et sa page en ligne indique « Payée ».
 * Identité de Meyana : nom et adresse dans le tableau de bord Stripe (informations publiques),
 * mentions légales (forme, capital, SIRET, RCS) dans MEYANA_LEGAL_MENTIONS, en pied de facture.
 */

const { stripe, httpError, ensureCustomer, findDoctor } = require('./billing');
const { TIME_ZONE } = require('./notifications/helpers');

const APPOINTMENT = 'api::appointment.appointment';
const DOCTOR = 'api::doctor.doctor';

// Régime de TVA de Meyana (factures d'abonnement et de commission). À revoir avec le comptable :
// une Meyana assujettie demandera un taux de TVA sur les abonnements et les commissions.
const MEYANA_VAT_MENTION = 'TVA non applicable, art. 293 B du CGI.';

/** Pied des factures Meyana : mentions légales puis TVA */
const meyanaFooter = () => [process.env.MEYANA_LEGAL_MENTIONS?.trim(), MEYANA_VAT_MENTION].filter(Boolean).join(' · ');

// Régimes de TVA du praticien (factures de consultation)
const VAT_REGIMES = {
	exempt_health: 'Exonération de TVA, art. 261-4-1° du CGI.',
	franchise: 'TVA non applicable, art. 293 B du CGI.',
	vat: null, // TVA 20 % incluse dans le prix
};
const VAT_RATE = 20;

const BILLING_FIELDS = ['siret', 'vatRegime', 'vatNumber', 'billingAddress'];

const cents = (euros) => Math.round(Number(euros) * 100);
const fullName = (p) => [p?.firstname, p?.lastname].filter(Boolean).join(' ');
const longDate = (date) =>
	new Date(date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: TIME_ZONE });
const euros = (value) =>
	`${Number(value).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

/* ------------------------------------------------------------------ */
/* Informations de facturation du praticien                            */
/* ------------------------------------------------------------------ */

const billingComplete = (doctor) =>
	Boolean(
		doctor?.siret &&
			doctor.vatRegime &&
			(doctor.vatRegime !== 'vat' || doctor.vatNumber) &&
			doctor.billingAddress?.line1 &&
			doctor.billingAddress?.postalCode &&
			doctor.billingAddress?.city
	);

const billingInfoOf = (doctor) => ({
	siret: doctor.siret || '',
	vatRegime: doctor.vatRegime || '',
	vatNumber: doctor.vatNumber || '',
	address: { line1: '', postalCode: '', city: '', ...(doctor.billingAddress || {}) },
	complete: billingComplete(doctor),
});

const stripeAddress = (address) => ({
	line1: address.line1,
	postal_code: address.postalCode,
	city: address.city,
	country: 'FR',
});

/** Mentions légales du praticien en tête de ses factures (SIRET, n° de TVA) */
const doctorFields = (doctor) =>
	[
		{ name: 'SIRET', value: doctor.siret },
		doctor.vatRegime === 'vat' && doctor.vatNumber ? { name: 'N° TVA', value: doctor.vatNumber } : null,
	].filter((field) => field?.value);

/** Le praticien en client de Meyana (abonnement, commission) : nom, adresse, SIRET, mention TVA */
const syncCustomer = async (doctor) => {
	if (!doctor.stripeCustomerId) return;
	await stripe().customers.update(doctor.stripeCustomerId, {
		name: fullName(doctor) || undefined,
		...(billingComplete(doctor) && { address: stripeAddress(doctor.billingAddress) }),
		invoice_settings: { custom_fields: doctorFields(doctor).length ? doctorFields(doctor) : '', footer: meyanaFooter() },
	});
};

/** Le praticien en émetteur de ses factures de consultation : nom et adresse */
const syncAccountProfile = async (doctor) => {
	if (!doctor.stripeAccountId || !billingComplete(doctor)) return;
	await stripe().accounts.update(doctor.stripeAccountId, {
		business_profile: { name: fullName(doctor), support_address: stripeAddress(doctor.billingAddress) },
	});
};

/** Au démarrage : clients Stripe des praticiens alignés sur leurs informations de facturation */
const syncBillingCustomers = async (strapi) => {
	if (!process.env.STRIPE_SECRET_KEY) return;
	const doctors = await strapi.db.query(DOCTOR).findMany({
		where: { stripeCustomerId: { $notNull: true } },
		select: ['id', 'firstname', 'lastname', 'stripeCustomerId', ...BILLING_FIELDS],
		limit: 5000,
	});
	for (const doctor of doctors) await syncCustomer(doctor);
};

const clean = (value) => String(value ?? '').trim();

/** PUT /payouts/billing-info : SIRET, régime de TVA, adresse de facturation */
const saveBillingInfo = async (strapi, doctor, input = {}) => {
	const siret = clean(input.siret).replace(/\s/g, '');
	const vatRegime = clean(input.vatRegime);
	const vatNumber = clean(input.vatNumber).replace(/\s/g, '').toUpperCase();
	const address = {
		line1: clean(input.address?.line1),
		postalCode: clean(input.address?.postalCode),
		city: clean(input.address?.city),
	};
	if (!/^\d{14}$/.test(siret)) throw httpError(400, 'Le SIRET doit comporter 14 chiffres.');
	if (!(vatRegime in VAT_REGIMES)) throw httpError(400, 'Choisissez votre régime de TVA.');
	if (vatRegime === 'vat' && !/^FR[0-9A-Z]{2}\d{9}$/.test(vatNumber)) {
		throw httpError(400, 'Le numéro de TVA intracommunautaire doit être au format FR + 11 caractères.');
	}
	if (!address.line1 || !/^\d{5}$/.test(address.postalCode) || !address.city) {
		throw httpError(400, 'Renseignez votre adresse de facturation complète.');
	}
	// hasBillingInfo : public, pour la checklist de validation de l'admin
	const data = { siret, vatRegime, vatNumber: vatRegime === 'vat' ? vatNumber : null, billingAddress: address, hasBillingInfo: true };
	await strapi.db.query(DOCTOR).update({ where: { id: doctor.id }, data });
	const updated = { ...doctor, ...data };
	await Promise.all([syncCustomer(updated), syncAccountProfile(updated)]);
	return billingInfoOf(updated);
};

/* ------------------------------------------------------------------ */
/* Facture de consultation (praticien → patient)                       */
/* ------------------------------------------------------------------ */

/** Taux de TVA 20 % inclus, créé une fois sur le compte du praticien assujetti */
const vatTaxRate = async (accountId) => {
	const options = { stripeAccount: accountId };
	const { data } = await stripe().taxRates.list({ active: true, limit: 100 }, options);
	const existing = data.find((rate) => rate.metadata?.meyana === 'vat20');
	if (existing) return existing.id;
	const rate = await stripe().taxRates.create(
		{ display_name: 'TVA', percentage: VAT_RATE, inclusive: true, country: 'FR', metadata: { meyana: 'vat20' } },
		{ ...options, idempotencyKey: `meyana-vat20-${accountId}` }
	);
	return rate.id;
};

const loadForInvoice = (strapi, id) =>
	strapi.db.query(APPOINTMENT).findOne({
		where: { id },
		select: ['id', 'documentId', 'datetime', 'reason', 'price', 'paidAt', 'paymentIntentId', 'paymentAccountId', 'invoiceId'],
		populate: {
			patient: { select: ['id', 'email', 'firstname', 'lastname', 'username'] },
			doctor: { select: ['id', 'documentId', 'firstname', 'lastname', 'stripeAccountId', ...BILLING_FIELDS] },
		},
	});

/**
 * Émet la facture d'une consultation payée et y rattache le paiement du patient.
 * Renvoie les champs à enregistrer sur le rendez-vous, ou null (praticien sans informations de
 * facturation : la facture sera émise dès qu'il les aura renseignées).
 */
const issueConsultationInvoice = async (strapi, appointmentId) => {
	const a = await loadForInvoice(strapi, appointmentId);
	if (!a || a.invoiceId || !a.paymentIntentId || !billingComplete(a.doctor)) return null;
	const accountId = a.paymentAccountId || a.doctor.stripeAccountId;
	const on = { stripeAccount: accountId };
	const key = (step) => ({ ...on, idempotencyKey: `meyana-invoice-${step}-${a.documentId}` });
	const doctorName = fullName(a.doctor);
	const patientName = fullName(a.patient) || a.patient?.username || 'Patient';

	const customer = await stripe().customers.create(
		{
			name: patientName,
			email: a.patient?.email || undefined,
			preferred_locales: ['fr-FR'],
			metadata: { meyanaUserId: String(a.patient?.id ?? '') },
		},
		key('customer')
	);
	const created = await stripe().invoices.create(
		{
			customer: customer.id,
			collection_method: 'send_invoice',
			days_until_due: 0,
			auto_advance: false,
			custom_fields: [...doctorFields(a.doctor), { name: 'Acquittée', value: `Carte bancaire, ${longDate(a.paidAt || new Date())}` }],
			footer: [
				VAT_REGIMES[a.doctor.vatRegime],
				`Facture établie par Meyana au nom et pour le compte de ${doctorName} (mandat de facturation).`,
			]
				.filter(Boolean)
				.join(' '),
			metadata: { meyana: 'consultation', appointmentDocumentId: a.documentId },
		},
		key('create')
	);
	let invoice = await stripe().invoices.retrieve(created.id, {}, on);
	if (invoice.status === 'draft') {
		await stripe().invoiceItems.create(
			{
				customer: customer.id,
				invoice: invoice.id,
				amount: cents(a.price),
				currency: 'eur',
				description: `Consultation${a.reason ? ` · ${a.reason}` : ''} · ${longDate(a.datetime)}`,
				...(a.doctor.vatRegime === 'vat' && { tax_rates: [await vatTaxRate(accountId)] }),
			},
			key('item')
		);
		invoice = await stripe().invoices.finalizeInvoice(invoice.id, { auto_advance: false }, on);
	}
	if (invoice.status === 'open') {
		try {
			invoice = await stripe().invoices.attachPayment(invoice.id, { payment_intent: a.paymentIntentId }, on);
		} catch (error) {
			strapi.log.warn(`Factures : paiement non rattaché à ${invoice.id} (${error.message}), facture marquée payée`);
			invoice = await stripe().invoices.pay(invoice.id, { paid_out_of_band: true }, on);
		}
	}
	return { invoiceId: invoice.id, invoiceNumber: invoice.number, invoiceUrl: invoice.hosted_invoice_url };
};

/** Le patient reçoit sa facture quand elle n'a pas pu partir avec la confirmation du rendez-vous */
const lateInvoiceEmail = async (strapi, appointmentId, fields) => {
	const { renderEmail } = require('./notifications/email');
	const a = await strapi.db.query(APPOINTMENT).findOne({
		where: { id: appointmentId },
		select: ['UUID', 'datetime', 'price'],
		populate: { patient: { select: ['id', 'firstname'] }, doctor: { select: ['firstname', 'lastname'] } },
	});
	if (!a?.patient) return;
	await strapi.service('api::notification.notification').emailUser({
		recipient: a.patient.id,
		category: 'account',
		email: {
			subject: `Votre facture · consultation du ${longDate(a.datetime)}`,
			...renderEmail({
				title: 'Votre facture est disponible',
				paragraphs: [
					a.patient.firstname ? `Bonjour ${a.patient.firstname},` : 'Bonjour,',
					`La facture de votre consultation avec ${fullName(a.doctor) || 'votre praticien'} est disponible. Vous la retrouvez à tout moment dans « Mes paiements ».`,
				],
				details: [
					['Consultation', longDate(a.datetime)],
					['Montant payé', euros(a.price)],
					['Facture', fields.invoiceNumber],
				],
				secondary: { url: fields.invoiceUrl, label: 'Voir ma facture' },
				link: '/dashboard/mes-paiements',
				cta: 'Mes paiements',
			}),
		},
	});
};

/** Tâche planifiée : factures et avoirs restés en attente (erreur passagère, informations complétées depuis) */
const issueMissingInvoices = async (strapi) => {
	const since = new Date(Date.now() - 30 * 86400000);
	const missing = await strapi.db.query(APPOINTMENT).findMany({
		where: { paymentStatus: { $in: ['paid', 'refunded'] }, invoiceId: { $null: true }, paidAt: { $gte: since } },
		select: ['id', 'documentId', 'paymentStatus', 'price'],
		limit: 20,
	});
	for (const appointment of missing) {
		try {
			const fields = await issueConsultationInvoice(strapi, appointment.id);
			if (!fields) continue;
			await strapi.db.query(APPOINTMENT).update({ where: { id: appointment.id }, data: fields });
			if (appointment.paymentStatus === 'refunded') {
				await creditConsultationInvoice(strapi, { ...appointment, ...fields });
			} else {
				// Facture émise après la confirmation (praticien sans informations de facturation à ce moment-là)
				await lateInvoiceEmail(strapi, appointment.id, fields);
			}
		} catch (error) {
			strapi.log.error(`Factures : consultation ${appointment.documentId} non facturée (${error.message})`);
		}
	}
	const uncredited = await strapi.db.query(APPOINTMENT).findMany({
		where: { paymentStatus: 'refunded', invoiceId: { $notNull: true }, creditNoteUrl: { $null: true }, refundedAt: { $gte: since } },
		select: ['id', 'documentId', 'invoiceId'],
		limit: 20,
	});
	for (const appointment of uncredited) {
		try {
			await creditConsultationInvoice(strapi, appointment);
		} catch (error) {
			strapi.log.error(`Factures : avoir de ${appointment.documentId} non émis (${error.message})`);
		}
	}
};

/** Consultation remboursée : avoir sur sa facture (enregistré sur le rendez-vous) */
const creditConsultationInvoice = async (strapi, appointment) => {
	if (!appointment?.invoiceId) return null;
	const row = await strapi.db.query(APPOINTMENT).findOne({
		where: { id: appointment.id },
		select: ['id', 'documentId', 'paymentAccountId', 'creditNoteUrl'],
	});
	if (!row || row.creditNoteUrl) return null;
	const on = { stripeAccount: row.paymentAccountId };
	const invoice = await stripe().invoices.retrieve(appointment.invoiceId, { expand: ['lines'] }, on);
	const line = invoice.lines.data[0];
	const creditNote = await stripe().creditNotes.create(
		{
			invoice: invoice.id,
			lines: [{ type: 'invoice_line_item', invoice_line_item: line.id, quantity: 1 }],
			out_of_band_amount: invoice.total,
			memo: 'Annulation de la consultation, remboursée sur la carte du patient.',
		},
		{ ...on, idempotencyKey: `meyana-credit-note-${row.documentId}` }
	);
	await strapi.db.query(APPOINTMENT).update({ where: { id: row.id }, data: { creditNoteUrl: creditNote.pdf } });
	return creditNote.pdf;
};

/* ------------------------------------------------------------------ */
/* Facture de commission (Meyana → praticien), à chaque virement       */
/* ------------------------------------------------------------------ */

/**
 * appointments : consultations du virement ({ datetime, price, commission (centimes) }).
 * Renvoie le lien de la facture, déjà acquittée (la commission est retenue à chaque paiement).
 */
const issueCommissionInvoice = async (strapi, doctor, user, payout, appointments, rate) => {
	// Client Meyana du praticien (créé avec la fiche complète : l'offre en dépend)
	const stripeCustomerId =
		doctor.stripeCustomerId || (await ensureCustomer(strapi, await findDoctor(strapi, { id: doctor.id }), user)).stripeCustomerId;
	const withCustomer = { ...doctor, stripeCustomerId };
	await syncCustomer(withCustomer);
	const key = (step) => ({ idempotencyKey: `meyana-commission-${step}-${payout.id}` });
	const created = await stripe().invoices.create(
		{
			customer: withCustomer.stripeCustomerId,
			collection_method: 'send_invoice',
			days_until_due: 0,
			auto_advance: false,
			description: `Commission Meyana (${rate} %, frais de paiement inclus) sur les consultations virées le ${longDate(
				payout.created * 1000
			)}.`,
			custom_fields: [...doctorFields(doctor), { name: 'Acquittée', value: 'Retenue sur vos encaissements' }],
			footer: meyanaFooter(),
			metadata: { meyana: 'commission', payoutId: payout.id },
		},
		key('create')
	);
	let invoice = await stripe().invoices.retrieve(created.id);
	if (invoice.status === 'draft') {
		for (const [i, a] of appointments.entries()) {
			await stripe().invoiceItems.create(
				{
					customer: withCustomer.stripeCustomerId,
					invoice: invoice.id,
					amount: a.commission,
					currency: 'eur',
					description: `Consultation du ${longDate(a.datetime)} (${euros(a.price)})`,
				},
				key(`item-${i}`)
			);
		}
		invoice = await stripe().invoices.finalizeInvoice(invoice.id, { auto_advance: false });
	}
	if (invoice.status === 'open') invoice = await stripe().invoices.pay(invoice.id, { paid_out_of_band: true });
	return invoice.hosted_invoice_url;
};

/* ------------------------------------------------------------------ */
/* Page « Factures » du praticien                                      */
/* ------------------------------------------------------------------ */

const listInvoices = async (strapi, doctor) => {
	let meyana = [];
	if (doctor.stripeCustomerId) {
		const { data } = await stripe().invoices.list({ customer: doctor.stripeCustomerId, limit: 100 });
		meyana = data
			.filter((invoice) => ['paid', 'open'].includes(invoice.status) && invoice.total > 0)
			.map((invoice) => ({
				id: invoice.id,
				number: invoice.number,
				date: new Date((invoice.status_transitions?.finalized_at || invoice.created) * 1000).toISOString(),
				kind: invoice.metadata?.meyana === 'commission' ? 'commission' : 'subscription',
				amount: invoice.total / 100,
				status: invoice.status,
				url: invoice.hosted_invoice_url,
				pdf: invoice.invoice_pdf,
			}));
	}
	const appointments = await strapi.db.query(APPOINTMENT).findMany({
		where: { doctor: { id: doctor.id }, invoiceId: { $notNull: true } },
		select: ['documentId', 'datetime', 'price', 'paidAt', 'paymentStatus', 'invoiceNumber', 'invoiceUrl', 'creditNoteUrl'],
		populate: { patient: { select: ['firstname', 'lastname', 'username'] } },
		orderBy: { paidAt: 'desc' },
		limit: 300,
	});
	return {
		meyana,
		consultations: appointments.map((a) => ({
			documentId: a.documentId,
			number: a.invoiceNumber,
			date: a.paidAt,
			consultationDate: a.datetime,
			patient: fullName(a.patient) || a.patient?.username || 'Patient',
			amount: Number(a.price),
			refunded: a.paymentStatus === 'refunded',
			url: a.invoiceUrl,
			creditNoteUrl: a.creditNoteUrl,
		})),
	};
};

/**
 * Liens à jour vers la facture d'une consultation (page en ligne, PDF) et son avoir éventuel :
 * relus chez Stripe à chaque ouverture. Réservé au patient et au praticien du rendez-vous.
 */
const invoiceLinks = async (strapi, user, documentId) => {
	const a = await strapi.db.query(APPOINTMENT).findOne({
		where: { documentId },
		select: ['id', 'invoiceId', 'paymentAccountId'],
		populate: {
			patient: { select: ['id'] },
			doctor: { select: ['id'], populate: { users_permissions_user: { select: ['id'] } } },
		},
	});
	const allowed = a && (a.patient?.id === user.id || a.doctor?.users_permissions_user?.id === user.id);
	if (!allowed) throw httpError(404, 'Facture introuvable.');
	if (!a.invoiceId) throw httpError(404, 'La facture de cette consultation n’est pas encore disponible.');
	const on = { stripeAccount: a.paymentAccountId };
	const invoice = await stripe().invoices.retrieve(a.invoiceId, {}, on);
	const { data: creditNotes } = await stripe().creditNotes.list({ invoice: a.invoiceId, limit: 1 }, on);
	return {
		number: invoice.number,
		url: invoice.hosted_invoice_url,
		pdf: invoice.invoice_pdf,
		creditNotePdf: creditNotes[0]?.pdf || null,
	};
};

/** Page « Mes paiements » du patient : consultations payées en ligne, remboursées comprises */
const patientPayments = async (strapi, user) => {
	const appointments = await strapi.db.query(APPOINTMENT).findMany({
		where: { patient: { id: user.id }, paymentStatus: { $in: ['paid', 'refunded'] } },
		select: ['documentId', 'UUID', 'datetime', 'reason', 'price', 'paidAt', 'refundedAt', 'paymentStatus', 'invoiceId', 'invoiceNumber'],
		populate: { doctor: { select: ['firstname', 'lastname'] } },
		orderBy: { paidAt: 'desc' },
		limit: 300,
	});
	return appointments.map((a) => ({
		documentId: a.documentId,
		uuid: a.UUID,
		datetime: a.datetime,
		reason: a.reason,
		doctor: fullName(a.doctor),
		amount: Number(a.price),
		paidAt: a.paidAt,
		refundedAt: a.refundedAt,
		refunded: a.paymentStatus === 'refunded',
		invoiceNumber: a.invoiceId ? a.invoiceNumber : null,
	}));
};

/** Facture d'abonnement payée (webhook invoice.paid) : email au praticien avec le lien */
const subscriptionInvoiceEmail = (doctor, invoice) => {
	const { renderEmail } = require('./notifications/email');
	const line = invoice.lines?.data?.[0];
	const period =
		line?.period?.start && line?.period?.end
			? `Du ${longDate(line.period.start * 1000)} au ${longDate(line.period.end * 1000)}`
			: null;
	const amount = euros(invoice.amount_paid / 100);
	return {
		subject: `Votre facture Meyana Premium : ${amount}`,
		...renderEmail({
			title: 'Paiement de votre abonnement reçu',
			paragraphs: [
				doctor.firstname ? `Bonjour ${doctor.firstname},` : 'Bonjour,',
				'Merci, le paiement de votre abonnement Meyana Premium a bien été reçu. Votre facture est disponible en ligne.',
			],
			details: [
				['Abonnement', 'Meyana Premium'],
				['Période', period],
				['Montant', amount],
				['Facture', invoice.number],
			],
			secondary: { url: invoice.hosted_invoice_url, label: 'Voir la facture' },
			link: '/dashboard/factures',
			cta: 'Toutes mes factures',
		}),
	};
};

module.exports = {
	meyanaFooter,
	BILLING_FIELDS,
	billingComplete,
	billingInfoOf,
	saveBillingInfo,
	syncCustomer,
	syncBillingCustomers,
	issueConsultationInvoice,
	issueMissingInvoices,
	creditConsultationInvoice,
	issueCommissionInvoice,
	listInvoices,
	invoiceLinks,
	patientPayments,
	subscriptionInvoiceEmail,
};
