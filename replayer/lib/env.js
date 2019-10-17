class Environment {
	/**
	 * @param {{
	 * 	urlReplaceRegexp?: string,
	 * 	urlReplaceTo?: string
	 * }} options
	 */
	constructor(options) {
		this.constructed = false;
		if (!options) {
			return;
		}

		this.constructed = true;
		this.urlReplaceRegexp = options.urlReplaceRegexp ? new RegExp(options.urlReplaceRegexp) : null;
		this.urlReplaceTo = options.urlReplaceTo;

		this.wrappers = [this.wrapUrl];
	}
	/**
	 * @param {Step} step
	 * @returns {Step}
	 */
	wrap(step) {
		if (!this.isConstructed()) {
			return step;
		}
		return this.getWrappers().reduce((step, wrapper) => wrapper.call(this, step), step);
	}
	wrapUrl(step) {
		const regexp = this.getUrlReplaceRegexp();
		if (step.url && regexp) {
			step.url = step.url.replace(regexp, this.getUrlReplaceTo());
		}
		return step;
	}
	getWrappers() {
		return this.wrappers;
	}
	isConstructed() {
		return this.constructed;
	}
	getUrlReplaceRegexp() {
		return this.urlReplaceRegexp;
	}
	getUrlReplaceTo() {
		return this.urlReplaceTo;
	}
}

module.exports = Environment;