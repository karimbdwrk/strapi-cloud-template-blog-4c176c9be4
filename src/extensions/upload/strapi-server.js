'use strict';

/**
 * Envoi de fichiers (POST /api/upload) : avec `?id=`, Strapi remplace le fichier existant
 * ou modifie ses informations. Les fichiers n'ont pas de propriétaire côté API : sans ce
 * garde-fou, n'importe quel compte connecté pourrait écraser l'avatar ou le document
 * médical d'un autre. Le site n'utilise jamais `?id=` : réservé au SuperAdmin.
 */

const { isAdmin } = require('../../utils/owned-content');

module.exports = (plugin) => {
	const createContentApi = plugin.controllers['content-api'];

	plugin.controllers['content-api'] = (deps) => {
		const controller = createContentApi(deps);
		const baseUpload = controller.upload;
		return {
			...controller,
			async upload(ctx) {
				if (ctx.query?.id && !isAdmin(ctx.state.user)) {
					return ctx.forbidden('Remplacement de fichier non autorisé.');
				}
				return baseUpload.call(this, ctx);
			},
		};
	};

	return plugin;
};
