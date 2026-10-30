'use strict';

const documents = require('../../../invoice-documents');

const fail = (ctx, error) => {
	if (!error.expose) strapi.log.error(`Factures : ${error.message}`);
	ctx.status = error.expose ? error.status : 502;
	ctx.body = {
		error: {
			status: ctx.status,
			message: error.expose ? error.message : 'La facture n’a pas pu être chargée. Réessayez dans un instant.',
		},
	};
};

module.exports = {
	async show(ctx) {
		try {
			ctx.set('Cache-Control', 'private, no-store');
			ctx.body = { data: await documents.loadDocument(strapi, ctx.params.ref, ctx.query.t) };
		} catch (error) {
			fail(ctx, error);
		}
	},

	async pdf(ctx) {
		try {
			const doc = await documents.loadDocument(strapi, ctx.params.ref, ctx.query.t);
			ctx.set('Content-Type', 'application/pdf');
			ctx.set('Content-Disposition', `attachment; filename="${documents.pdfFilename(doc)}"`);
			ctx.set('Cache-Control', 'private, no-store');
			ctx.body = await documents.renderPdf(doc);
		} catch (error) {
			fail(ctx, error);
		}
	},
};
