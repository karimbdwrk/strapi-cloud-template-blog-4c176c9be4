'use strict';

/**
 * Page « Paiements » de l'admin : abonnements et consultations encaissés, revenus de Meyana
 * (abonnements + commissions), remboursements et virements du lundi aux praticiens.
 *
 * - Consultations : lues en base (montant, commission, statut, virement).
 * - Abonnements et factures de commission : factures du compte Stripe de Meyana.
 * - Virements : regroupés en base par virement, état et date d'arrivée relus chez Stripe.
 */

const { stripe } = require('./billing');
const { PERIODS, parisKey, bucketOf, rangeFor } = require('./stats-range');

const APPOINTMENT = 'api::appointment.appointment';
const DOCTOR = 'api::doctor.doctor';
const COMMISSION_RATE = 0.05;

const cents = (euros) => Math.round(Number(euros || 0) * 100);
const commissionOf = (amountCents) => Math.round(amountCents * COMMISSION_RATE);
const fullName = (p) => [p?.firstname, p?.lastname].filter(Boolean).join(' ');
const toEuros = (c) => c / 100;
const shortDate = (seconds) =>
	new Date(seconds * 1000).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Paris' });
/** « Premium, du 29 oct. 2026 au 29 nov. 2026 » */
const periodLabel = (period) =>
	period?.start && period?.end ? `Premium, du ${shortDate(period.start)} au ${shortDate(period.end)}` : 'Premium';

/** Factures Meyana (abonnements, commissions) émises depuis `from` */
const platformInvoices = async (from) => {
	const invoices = [];
	for await (const invoice of stripe().invoices.list({ created: { gte: Math.floor(from.getTime() / 1000) }, limit: 100 })) {
		invoices.push(invoice);
		if (invoices.length >= 2000) break;
	}
	return invoices.filter((i) => i.total > 0 && ['paid', 'open', 'uncollectible'].includes(i.status));
};

/** Consultations payées ou remboursées depuis `from` */
const consultations = (strapi, from) =>
	strapi.db.query(APPOINTMENT).findMany({
		where: {
			paymentStatus: { $in: ['paid', 'refunded'] },
			$or: [{ paidAt: { $gte: from } }, { refundedAt: { $gte: from } }, { paidOutAt: { $gte: from } }],
		},
		select: [
			'documentId',
			'UUID',
			'datetime',
			'price',
			'paymentStatus',
			'paidAt',
			'refundedAt',
			'paidOutAt',
			'payoutId',
			'paymentAccountId',
			'invoiceId',
			'invoiceNumber',
		],
		populate: {
			patient: { select: ['firstname', 'lastname', 'username'] },
			doctor: { select: ['documentId', 'firstname', 'lastname'] },
		},
		limit: 10000,
	});

/** État et date d'arrivée des virements chez Stripe (les plus récents d'abord, 60 au plus) */
const payoutStatuses = async (strapi, payouts) => {
	const statuses = new Map();
	for (const p of payouts.slice(0, 60)) {
		try {
			const payout = await stripe().payouts.retrieve(p.id, {}, { stripeAccount: p.accountId });
			statuses.set(p.id, {
				status: payout.status,
				arrivalDate: payout.arrival_date ? new Date(payout.arrival_date * 1000).toISOString() : null,
			});
		} catch (error) {
			strapi.log.warn(`Paiements admin : virement ${p.id} illisible (${error.message})`);
		}
	}
	return statuses;
};

const overview = async (strapi, periodKey) => {
	const range = rangeFor(PERIODS[periodKey] ? periodKey : '30d');
	const [rows, invoices, doctors] = await Promise.all([
		consultations(strapi, range.from),
		platformInvoices(range.from),
		strapi.db.query(DOCTOR).findMany({
			where: { stripeCustomerId: { $notNull: true } },
			select: ['documentId', 'firstname', 'lastname', 'stripeCustomerId'],
			limit: 10000,
		}),
	]);
	const doctorByCustomer = new Map(doctors.map((d) => [d.stripeCustomerId, d]));
	const inCurrent = (date) => {
		if (!date) return false;
		const key = parisKey(date);
		return key >= range.start && key <= range.end;
	};
	const inPrevious = (date) => {
		if (!date) return false;
		const key = parisKey(date);
		return key >= range.prevStart && key < range.start;
	};

	/* ---------- Transactions ---------- */

	const consultationItems = rows
		.filter((a) => a.paidAt)
		.map((a) => {
			const amount = cents(a.price);
			const refunded = a.paymentStatus === 'refunded';
			return {
				id: a.documentId,
				type: 'consultation',
				date: a.paidAt,
				refundedAt: a.refundedAt,
				payer: fullName(a.patient) || a.patient?.username || 'Patient',
				doctor: fullName(a.doctor),
				doctorDocumentId: a.doctor?.documentId,
				appointmentUuid: a.UUID,
				consultationDate: a.datetime,
				amount: toEuros(amount),
				commission: refunded ? 0 : toEuros(commissionOf(amount)),
				status: refunded ? 'refunded' : a.paidOutAt ? 'paid_out' : 'paid',
				invoice: a.invoiceId ? { documentId: a.documentId, number: a.invoiceNumber } : null,
			};
		});

	// Abonnements : factures rattachées à un abonnement (les factures de commission ont leur propre section)
	const subscriptionInvoices = invoices.filter(
		(i) => i.parent?.subscription_details?.subscription || i.subscription || i.billing_reason?.startsWith('subscription')
	);
	const subscriptionItems = subscriptionInvoices.map((i) => {
		const doctor = doctorByCustomer.get(i.customer);
		const paidAt = i.status_transitions?.paid_at || i.created;
		return {
			id: i.id,
			type: 'subscription',
			date: new Date(paidAt * 1000).toISOString(),
			payer: fullName(doctor) || i.customer_name || i.customer_email || 'Praticien',
			doctor: fullName(doctor) || i.customer_name || '',
			doctorDocumentId: doctor?.documentId,
			amount: toEuros(i.total),
			commission: 0,
			status: i.status === 'paid' ? 'paid' : i.status === 'open' ? 'open' : 'failed',
			description: periodLabel(i.lines?.data?.[0]?.period),
			invoice: { number: i.number, url: i.hosted_invoice_url, pdf: i.invoice_pdf },
		};
	});

	const transactions = [...consultationItems, ...subscriptionItems]
		.filter((t) => inCurrent(t.date))
		.sort((a, b) => new Date(b.date) - new Date(a.date));

	/* ---------- Indicateurs et séries ---------- */

	const totals = (pick) => {
		const t = { subscriptions: 0, consultations: 0, consultationCount: 0, commissions: 0, refunds: 0, refundCount: 0, paidOut: 0 };
		for (const s of subscriptionItems) if (s.status === 'paid' && pick(s.date)) t.subscriptions += cents(s.amount);
		for (const a of rows) {
			const amount = cents(a.price);
			if (pick(a.paidAt)) {
				t.consultations += amount;
				t.consultationCount += 1;
				if (a.paymentStatus === 'paid') t.commissions += commissionOf(amount);
			}
			if (a.paymentStatus === 'refunded' && pick(a.refundedAt)) {
				t.refunds += amount;
				t.refundCount += 1;
			}
			if (a.paidOutAt && pick(a.paidOutAt)) t.paidOut += amount - commissionOf(amount);
		}
		return {
			subscriptions: toEuros(t.subscriptions),
			consultations: toEuros(t.consultations),
			consultationCount: t.consultationCount,
			commissions: toEuros(t.commissions),
			revenue: toEuros(t.subscriptions + t.commissions),
			refunds: toEuros(t.refunds),
			refundCount: t.refundCount,
			paidOut: toEuros(t.paidOut),
		};
	};

	const buckets = Object.fromEntries(range.buckets.map((key) => [key, { subscriptions: 0, commissions: 0, consultations: 0 }]));
	const add = (date, field, value) => {
		if (!inCurrent(date)) return;
		const key = bucketOf(parisKey(date), range.unit);
		if (buckets[key]) buckets[key][field] += value;
	};
	for (const s of subscriptionItems) if (s.status === 'paid') add(s.date, 'subscriptions', cents(s.amount));
	for (const a of rows) {
		const amount = cents(a.price);
		add(a.paidAt, 'consultations', amount);
		if (a.paymentStatus === 'paid') add(a.paidAt, 'commissions', commissionOf(amount));
	}

	/* ---------- Virements du lundi ---------- */

	const commissionInvoices = new Map(
		invoices
			.filter((i) => i.metadata?.meyana === 'commission' && i.metadata?.payoutId)
			.map((i) => [i.metadata.payoutId, { number: i.number, url: i.hosted_invoice_url, pdf: i.invoice_pdf }])
	);
	const byPayout = new Map();
	for (const a of rows) {
		if (!a.payoutId || !inCurrent(a.paidOutAt)) continue;
		const amount = cents(a.price);
		const row = byPayout.get(a.payoutId) ?? {
			id: a.payoutId,
			accountId: a.paymentAccountId,
			date: a.paidOutAt,
			doctor: fullName(a.doctor),
			doctorDocumentId: a.doctor?.documentId,
			count: 0,
			gross: 0,
			commission: 0,
		};
		row.count += 1;
		row.gross += amount;
		row.commission += commissionOf(amount);
		byPayout.set(a.payoutId, row);
	}
	const payouts = [...byPayout.values()].sort((a, b) => new Date(b.date) - new Date(a.date));
	const statuses = await payoutStatuses(strapi, payouts);

	return {
		period: range.period,
		unit: range.unit,
		summary: totals(inCurrent),
		previous: totals(inPrevious),
		buckets: range.buckets.map((key) => ({
			key,
			subscriptions: toEuros(buckets[key].subscriptions),
			commissions: toEuros(buckets[key].commissions),
			consultations: toEuros(buckets[key].consultations),
		})),
		transactions: transactions.slice(0, 500),
		payouts: payouts.map(({ accountId, ...p }) => ({
			...p,
			gross: toEuros(p.gross),
			commission: toEuros(p.commission),
			net: toEuros(p.gross - p.commission),
			status: statuses.get(p.id)?.status || null,
			arrivalDate: statuses.get(p.id)?.arrivalDate || null,
			commissionInvoice: commissionInvoices.get(p.id) || null,
		})),
	};
};

module.exports = { PERIODS, overview };
