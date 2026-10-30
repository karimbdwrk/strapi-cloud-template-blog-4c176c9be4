'use strict';

/**
 * Factures et avoirs aux couleurs de Meyana, sur meyana.fr (page en ligne et PDF).
 *
 * Stripe reste la source des factures (numérotation, montants, paiement rattaché) ; ce module les
 * relit et les présente dans la charte Meyana, à la place des pages et PDF hébergés par Stripe.
 *
 * Références (dans l'adresse /facture/<ref>) :
 * - c-<documentId du rendez-vous> : facture de consultation (compte Stripe du praticien) ;
 * - a-<documentId du rendez-vous> : avoir de cette consultation (remboursement) ;
 * - m-<id de facture Stripe>      : facture Meyana au praticien (abonnement ou commission).
 *
 * Les liens portent une signature (?t=) : comme les pages Stripe, ils s'ouvrent sans connexion
 * (lien de l'email) mais ne se devinent pas. Clé : INVOICE_LINK_SECRET, à défaut APP_KEYS.
 */

const crypto = require('crypto');
const path = require('path');
const PDFDocument = require('pdfkit');

const { stripe, httpError } = require('./billing');
const { TIME_ZONE } = require('./notifications/helpers');

const APPOINTMENT = 'api::appointment.appointment';
const DOCTOR = 'api::doctor.doctor';
const ASSETS = path.join(__dirname, '..', 'assets', 'invoice');

const fullName = (p) => [p?.firstname, p?.lastname].filter(Boolean).join(' ');
const frontUrl = () => (process.env.FRONT_URL || 'http://localhost:3010').replace(/\/$/, '');
const toIso = (seconds) => (seconds ? new Date(seconds * 1000).toISOString() : null);

/* ------------------------------------------------------------------ */
/* Liens signés                                                        */
/* ------------------------------------------------------------------ */

const linkSecret = () => {
	const secret = process.env.INVOICE_LINK_SECRET || process.env.APP_KEYS;
	if (!secret) throw httpError(503, 'Factures indisponibles : clé de signature manquante.');
	return secret;
};

const sign = (ref) => crypto.createHmac('sha256', linkSecret()).update(ref).digest('base64url').slice(0, 24);

const validSignature = (ref, token) => {
	const expected = Buffer.from(sign(ref));
	const given = Buffer.from(String(token || ''));
	return given.length === expected.length && crypto.timingSafeEqual(given, expected);
};

/** { url, pdf } : page en ligne et PDF d'une facture ou d'un avoir */
const documentLinks = (ref) => {
	const token = sign(ref);
	return {
		url: `${frontUrl()}/facture/${ref}?t=${token}`,
		pdf: `${frontUrl()}/facture/${ref}/pdf?t=${token}`,
	};
};

const consultationRef = (documentId) => `c-${documentId}`;
const creditNoteRef = (documentId) => `a-${documentId}`;
const platformRef = (invoiceId) => `m-${invoiceId}`;

/* ------------------------------------------------------------------ */
/* Lecture d'une facture                                               */
/* ------------------------------------------------------------------ */

const shortDate = (seconds) =>
	new Date(seconds * 1000).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: TIME_ZONE });

/** Champs personnalisés Stripe : « Acquittée » à part, le reste (SIRET, n° de TVA) en identifiants */
const splitCustomFields = (fields) => ({
	paid: fields?.find((f) => f.name === 'Acquittée')?.value || null,
	ids: (fields || []).filter((f) => f.name !== 'Acquittée').map((f) => ({ label: f.name, value: f.value })),
});

const addressLines = (address) =>
	address
		? [address.line1, address.line2, [address.postal_code ?? address.postalCode, address.city].filter(Boolean).join(' ')].filter(Boolean)
		: [];

/** Pied Stripe (« mention TVA · mentions légales ») en lignes de mentions */
const footerNotes = (footer) =>
	String(footer || '')
		.split(/ · |\n/)
		.map((line) => line.trim())
		.filter(Boolean);

const totalsOf = (doc) => {
	const total = doc.total;
	const excluding = doc.total_excluding_tax ?? doc.subtotal_excluding_tax ?? total;
	const tax = total - excluding;
	return { subtotal: excluding, tax: tax > 0 ? { label: 'TVA 20 %', amount: tax } : null, total };
};

const meyanaIssuer = () => ({
	name: process.env.MEYANA_COMPANY_NAME?.trim() || 'Meyana',
	lines: String(process.env.MEYANA_ADDRESS || '')
		.split(/\n|,(?=\s*\d{5})/)
		.map((line) => line.trim())
		.filter(Boolean),
	ids: [],
});

const loadAppointment = (strapi, documentId) =>
	strapi.db.query(APPOINTMENT).findOne({
		where: { documentId },
		select: ['documentId', 'datetime', 'invoiceId', 'paymentAccountId', 'creditNoteUrl', 'paidAt'],
		populate: {
			patient: { select: ['firstname', 'lastname', 'username', 'email'] },
			doctor: { select: ['firstname', 'lastname', 'siret', 'vatRegime', 'vatNumber', 'billingAddress'] },
		},
	});

/** Praticien émetteur de ses factures de consultation */
const doctorIssuer = (doctor, ids) => ({
	name: fullName(doctor) || 'Praticien',
	lines: addressLines(doctor?.billingAddress),
	ids,
});

const consultationDocument = async (strapi, documentId, { creditNote = false } = {}) => {
	const a = await loadAppointment(strapi, documentId);
	if (!a?.invoiceId) throw httpError(404, 'Facture introuvable.');
	const on = { stripeAccount: a.paymentAccountId };
	const invoice = await stripe().invoices.retrieve(a.invoiceId, {}, on);
	const { paid, ids } = splitCustomFields(invoice.custom_fields);
	const issuer = doctorIssuer(a.doctor, ids);
	const customer = {
		name: invoice.customer_name || fullName(a.patient) || a.patient?.username || 'Patient',
		lines: [invoice.customer_email || a.patient?.email].filter(Boolean),
		ids: [],
	};
	const notes = footerNotes(invoice.footer);

	if (creditNote) {
		const { data } = await stripe().creditNotes.list({ invoice: invoice.id, limit: 1 }, on);
		const note = data[0];
		if (!note) throw httpError(404, 'Avoir introuvable.');
		return {
			type: 'credit_note',
			kind: 'consultation',
			number: note.number,
			issuedAt: toIso(note.created),
			status: 'refunded',
			paymentLabel: 'Sur la carte bancaire du patient',
			issuer,
			customer,
			reference: { label: `Avoir sur la facture ${invoice.number}`, ref: consultationRef(documentId) },
			items: note.lines.data.map((line) => ({ description: line.description, quantity: line.quantity || 1, amount: line.amount })),
			...totalsOf(note),
			currency: note.currency,
			notes: [note.memo, ...notes].filter(Boolean),
			links: documentLinks(creditNoteRef(documentId)),
			related: { label: 'Voir la facture', ...documentLinks(consultationRef(documentId)) },
		};
	}

	return {
		type: 'invoice',
		kind: 'consultation',
		number: invoice.number,
		issuedAt: toIso(invoice.status_transitions?.finalized_at || invoice.created),
		status: invoice.status === 'paid' ? 'paid' : invoice.status,
		paymentLabel: paid,
		issuer,
		customer,
		reference: null,
		items: invoice.lines.data.map((line) => ({ description: line.description, quantity: line.quantity || 1, amount: line.amount })),
		...totalsOf(invoice),
		currency: invoice.currency,
		notes,
		links: documentLinks(consultationRef(documentId)),
		related: a.creditNoteUrl ? { label: 'Voir l’avoir (remboursement)', ...documentLinks(creditNoteRef(documentId)) } : null,
	};
};

/** Ligne d'abonnement : « Meyana Premium · du 29 octobre 2026 au 29 novembre 2026 » */
const subscriptionLine = (line) =>
	line.period?.start && line.period?.end
		? `Meyana Premium · du ${shortDate(line.period.start)} au ${shortDate(line.period.end)}`
		: line.description || 'Meyana Premium';

const isSubscription = (invoice) =>
	Boolean(invoice.parent?.subscription_details?.subscription || invoice.subscription || invoice.billing_reason?.startsWith('subscription'));

/**
 * Praticien client d'une facture Meyana : adresse et SIRET relus sur sa fiche quand la facture
 * ne les porte pas (factures émises avant qu'il ne renseigne ses informations de facturation)
 */
const platformCustomer = async (strapi, invoice, ids) => {
	const doctor = invoice.customer
		? await strapi.db.query(DOCTOR).findOne({
				where: { stripeCustomerId: typeof invoice.customer === 'string' ? invoice.customer : invoice.customer.id },
				select: ['firstname', 'lastname', 'siret', 'vatRegime', 'vatNumber', 'billingAddress'],
		  })
		: null;
	const lines = addressLines(invoice.customer_address);
	const doctorIds = [
		{ label: 'SIRET', value: doctor?.siret },
		doctor?.vatRegime === 'vat' ? { label: 'N° TVA', value: doctor.vatNumber } : null,
	].filter((id) => id?.value);
	return {
		name: invoice.customer_name || fullName(doctor) || 'Praticien',
		lines: lines.length ? lines : addressLines(doctor?.billingAddress),
		ids: ids.length ? ids : doctorIds,
	};
};

const platformDocument = async (strapi, invoiceId) => {
	const invoice = await stripe().invoices.retrieve(invoiceId);
	const kind = invoice.metadata?.meyana === 'commission' ? 'commission' : isSubscription(invoice) ? 'subscription' : null;
	if (!kind || invoice.status === 'draft' || invoice.status === 'void') throw httpError(404, 'Facture introuvable.');
	const { paid, ids } = splitCustomFields(invoice.custom_fields);
	const paidAt = invoice.status_transitions?.paid_at;
	return {
		type: 'invoice',
		kind,
		number: invoice.number,
		issuedAt: toIso(invoice.status_transitions?.finalized_at || invoice.created),
		status: invoice.status === 'paid' ? 'paid' : invoice.status,
		paymentLabel: paid || (invoice.status === 'paid' && paidAt ? `Payée le ${shortDate(paidAt)}` : null),
		issuer: meyanaIssuer(),
		customer: await platformCustomer(strapi, invoice, ids),
		reference: null,
		intro: invoice.description || null,
		items: invoice.lines.data.map((line) => ({
			description: kind === 'subscription' ? subscriptionLine(line) : line.description,
			quantity: line.quantity || 1,
			amount: line.amount,
		})),
		...totalsOf(invoice),
		currency: invoice.currency,
		// Pied Meyana (mentions légales, TVA) : celui de la facture, sinon celui d'aujourd'hui
		notes: footerNotes(invoice.footer || require('./invoices').meyanaFooter()),
		links: documentLinks(platformRef(invoice.id)),
		related: null,
	};
};

/** Facture ou avoir d'une référence signée, prêt à afficher */
const loadDocument = async (strapi, ref, token) => {
	if (!/^[cam]-[A-Za-z0-9_]{6,80}$/.test(ref || '') || !validSignature(ref, token)) {
		throw httpError(404, 'Facture introuvable.');
	}
	const id = ref.slice(2);
	try {
		if (ref.startsWith('c-')) return await consultationDocument(strapi, id);
		if (ref.startsWith('a-')) return await consultationDocument(strapi, id, { creditNote: true });
		return await platformDocument(strapi, id);
	} catch (error) {
		if (error.status) throw error;
		strapi.log.error(`Factures : ${ref} illisible (${error.message})`);
		throw httpError(404, 'Facture introuvable.');
	}
};

/* ------------------------------------------------------------------ */
/* PDF                                                                 */
/* ------------------------------------------------------------------ */

const COLORS = {
	ink: '#1e352f',
	muted: '#5e6e5d',
	soft: '#8a8f86',
	line: '#e6ddd3',
	panel: '#f6f0ea',
	sage: '#89947c',
	accent: '#b05a3a',
};

// Espaces fines de toLocaleString : remplacées par des espaces insécables (présentes dans les polices)
const text = (value) => String(value ?? '').replace(/ /g, ' ');
const money = (cents, currency = 'eur') =>
	text((cents / 100).toLocaleString('fr-FR', { style: 'currency', currency: currency.toUpperCase() }));
const day = (iso) =>
	iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: TIME_ZONE }) : '';

const TITLES = {
	invoice: 'Facture',
	credit_note: 'Avoir',
};

/** Nom du fichier PDF : « facture-HN8G9V3U-0008.pdf », « avoir-… » */
const pdfFilename = (doc) => `${doc.type === 'credit_note' ? 'avoir' : 'facture'}-${String(doc.number || 'meyana').replace(/[^A-Za-z0-9-]/g, '')}.pdf`;

const renderPdf = (doc) =>
	new Promise((resolve, reject) => {
		const pdf = new PDFDocument({ size: 'A4', margins: { top: 50, left: 50, right: 50, bottom: 20 }, info: { Title: `${TITLES[doc.type]} ${doc.number}`, Author: 'Meyana' } });
		const chunks = [];
		pdf.on('data', (chunk) => chunks.push(chunk));
		pdf.on('end', () => resolve(Buffer.concat(chunks)));
		pdf.on('error', reject);

		pdf.registerFont('serif', path.join(ASSETS, 'fraunces-latin-400-normal.woff'));
		pdf.registerFont('serif-italic', path.join(ASSETS, 'fraunces-latin-400-italic.woff'));
		pdf.registerFont('sans', path.join(ASSETS, 'montserrat-latin-400-normal.woff'));
		pdf.registerFont('sans-bold', path.join(ASSETS, 'montserrat-latin-600-normal.woff'));

		const left = 50;
		const right = pdf.page.width - 50;
		const width = right - left;

		// En-tête : logo, titre et numéro
		pdf.image(path.join(ASSETS, 'meyana-logo.png'), left, 50, { width: 120 });
		pdf.font('serif').fontSize(28).fillColor(COLORS.ink).text(TITLES[doc.type], left, 44, { width, align: 'right' });
		pdf.font('sans').fontSize(9).fillColor(COLORS.muted);
		pdf.text(`N° ${text(doc.number)}`, left, 80, { width, align: 'right' });
		pdf.text(`${doc.type === 'credit_note' ? 'Émis' : 'Émise'} le ${day(doc.issuedAt)}`, { width, align: 'right' });
		if (doc.reference) pdf.text(text(doc.reference.label), { width, align: 'right' });

		// Émetteur et client
		const partyTop = 140;
		const column = (party, label, x) => {
			pdf.font('sans-bold').fontSize(7.5).fillColor(COLORS.muted).text(label.toUpperCase(), x, partyTop, { characterSpacing: 0.8 });
			pdf.font('serif').fontSize(13).fillColor(COLORS.ink).text(text(party.name), x, partyTop + 14, { width: width / 2 - 20 });
			pdf.font('sans').fontSize(9).fillColor(COLORS.ink);
			for (const line of party.lines) pdf.text(text(line), { width: width / 2 - 20 });
			pdf.fillColor(COLORS.muted);
			for (const id of party.ids) pdf.text(`${text(id.label)} : ${text(id.value)}`, { width: width / 2 - 20 });
			return pdf.y;
		};
		const bottom = Math.max(column(doc.issuer, doc.type === 'credit_note' ? 'Émis par' : 'Émise par', left), column(doc.customer, doc.type === 'credit_note' ? 'Au bénéfice de' : 'Facturée à', left + width / 2));

		// Bandeau d'état : « Acquittée · Carte bancaire, 30 octobre 2026 »
		let y = bottom + 24;
		const paid = doc.status === 'paid' || doc.status === 'refunded';
		pdf.roundedRect(left, y, width, 30, 8).fill(COLORS.panel);
		pdf.font('sans-bold').fontSize(9).fillColor(paid ? COLORS.muted : COLORS.accent);
		const statusLabel = doc.status === 'refunded' ? 'Remboursé' : paid ? 'Acquittée' : 'À régler';
		pdf.text(statusLabel, left + 14, y + 10, { continued: Boolean(doc.paymentLabel) });
		if (doc.paymentLabel) pdf.font('sans').fillColor(COLORS.ink).text(`  ·  ${text(doc.paymentLabel)}`);
		y += 50;

		if (doc.intro) {
			pdf.font('sans').fontSize(9).fillColor(COLORS.muted).text(text(doc.intro), left, y, { width });
			y = pdf.y + 14;
		}

		// Lignes
		const qtyX = right - 150;
		const amountX = right - 90;
		pdf.font('sans-bold').fontSize(7.5).fillColor(COLORS.muted);
		pdf.text('DÉSIGNATION', left, y, { characterSpacing: 0.8 });
		pdf.text('QTÉ', qtyX, y, { width: 40, align: 'right', characterSpacing: 0.8 });
		pdf.text('MONTANT', amountX, y, { width: 90, align: 'right', characterSpacing: 0.8 });
		y += 16;
		pdf.moveTo(left, y).lineTo(right, y).lineWidth(0.8).strokeColor(COLORS.line).stroke();
		for (const item of doc.items) {
			y += 10;
			if (y > pdf.page.height - 200) {
				pdf.addPage();
				y = 60;
			}
			pdf.font('sans').fontSize(9.5).fillColor(COLORS.ink).text(text(item.description), left, y, { width: qtyX - left - 20 });
			const rowBottom = pdf.y;
			pdf.text(String(item.quantity), qtyX, y, { width: 40, align: 'right' });
			pdf.text(money(item.amount, doc.currency), amountX, y, { width: 90, align: 'right' });
			y = Math.max(rowBottom, y + 12) + 10;
			pdf.moveTo(left, y).lineTo(right, y).lineWidth(0.5).strokeColor(COLORS.line).stroke();
		}

		// Totaux
		y += 16;
		const totalsX = right - 220;
		const totalRow = (label, value) => {
			pdf.font('sans').fontSize(9).fillColor(COLORS.muted).text(label, totalsX, y, { width: 120 });
			pdf.fillColor(COLORS.ink).text(value, totalsX + 120, y, { width: 100, align: 'right' });
			y += 16;
		};
		if (doc.tax) {
			totalRow('Total HT', money(doc.subtotal, doc.currency));
			totalRow(`${doc.tax.label}`, money(doc.tax.amount, doc.currency));
		}
		y += 4;
		pdf.moveTo(totalsX, y).lineTo(right, y).lineWidth(0.8).strokeColor(COLORS.ink).stroke();
		y += 10;
		pdf.font('sans-bold').fontSize(10).fillColor(COLORS.ink).text(doc.tax ? 'Total TTC' : 'Total', totalsX, y + 4, { width: 120 });
		pdf.font('serif').fontSize(18).text(money(doc.total, doc.currency), totalsX + 100, y, { width: 120, align: 'right' });

		// Mentions en pied de page
		const notes = doc.notes.map(text);
		pdf.font('sans').fontSize(7.5);
		const notesHeight = notes.reduce((h, note) => h + pdf.heightOfString(note, { width }) + 3, 0);
		let notesY = pdf.page.height - 60 - notesHeight;
		pdf.moveTo(left, notesY - 12).lineTo(right, notesY - 12).lineWidth(0.5).strokeColor(COLORS.line).stroke();
		pdf.fillColor(COLORS.soft);
		for (const note of notes) {
			pdf.text(note, left, notesY, { width });
			notesY = pdf.y + 3;
		}
		pdf.font('serif-italic').fontSize(8).fillColor(COLORS.sage).text('meyana.fr', left, pdf.page.height - 45, { width, align: 'center' });

		pdf.end();
	});

module.exports = {
	consultationRef,
	creditNoteRef,
	platformRef,
	documentLinks,
	loadDocument,
	renderPdf,
	pdfFilename,
};
