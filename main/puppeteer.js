const { ipcMain, BrowserWindow } = require('electron');
const puppeteer = require('puppeteer');
const uuidv4 = require('uuid/v4');

const getChromiumExecPath = () => {
	return puppeteer.executablePath().replace('app.asar', 'app.asar.unpacked');
};

class AllPagesCache {
	constructor() {
		this.pages = {};
		this.ready = {};
	}
	/**
	 * @param {string} uuid
	 * @param {Page} page
	 */
	add(uuid, page) {
		this.pages[uuid] = page;
		this.prepare[uuid] = [];
	}
	/**
	 * @param {string} uuid
	 * @param {Function} preparation
	 */
	prepare(uuid, preparation) {
		const chain = this.prepare[uuid];
		if (chain && chain.length === 0) {
			chain.push(true);
			preparation();
		}
	}
	exists(page) {
		return this.findUuidByPage(page) != null;
	}
	findUuidByPage(page) {
		return Object.keys(this.pages).find(uuid => this.pages[uuid] === page);
	}
	/**
	 * @param {string} uuid
	 */
	removeByUuid(uuid) {
		delete this.pages[uuid];
		delete this.prepare[uuid];
	}
	/**
	 * @param {Page} page
	 * @returns {string}
	 */
	removeByPage(page) {
		const uuid = this.findUuidByPage(page);
		if (uuid) {
			this.removeByUuid(uuid);
			return uuid;
		} else {
			return null;
		}
	}
}

/** stop pick dom from page */
const createPageWindowEventRecorder = flowKey => (eventJsonStr, onPickDOM) => {
	if (!eventJsonStr) {
		console.warn('Argument is null.');
		return;
	}
	try {
		const windows = BrowserWindow.getAllWindows();
		const jsonEvent = JSON.parse(eventJsonStr);
		if (onPickDOM) {
			windows[0].show();
			windows[0].focus();
			windows[0].focusOnWebView();
			windows[0].webContents.send(`dom-on-page-picked`, { path: jsonEvent.path });
		} else {
			windows[0].webContents.send(`message-captured-${flowKey}`, jsonEvent);
		}
	} catch (e) {
		console.error(e);
	}
};
const captureScreenshot = async page => {
	// wait for ui render
	// await page.waitForNavigation({ waitUntil: 'networkidle2' });
	return await page.screenshot({ encoding: 'base64' });
};
/**
 * expose function to given page
 * @param {Page} page
 * @param {string} flowKey
 * @param {AllPagesCache} allPages
 */
const exposeFunctionToPage = async (page, flowKey, allPages) => {
	const uuid = allPages.findUuidByPage(page);
	await page.exposeFunction('$lhGetUuid', () => uuid);
	await page.exposeFunction('$lhGetFlowKey', () => flowKey);
	await page.exposeFunction('$lhRecordEvent', createPageWindowEventRecorder(flowKey));
};
/**
 * install listeners on given page
 * @param {Page} page
 */
const installListenersOnPage = async page => {
	console.log('install listener on page');
	const god = () => {
		if (window.$lhGod) {
			return;
		}

		window.$lhGod = true;
		console.log('%c last-hit: %c evaluate on new document start...', 'color:red', 'color:brown');
		const ignoredIdRegexps = [/^md-.+-.{6,16}$/, /^select2-select2-.+$/];
		const shouldIgnore = id => ignoredIdRegexps.some(regexp => regexp.test(id));
		// here we are in the browser context
		const createXPathFromElement = elm => {
			var allNodes = document.getElementsByTagName('*');
			for (var segs = []; elm && elm.nodeType == 1; elm = elm.parentNode) {
				if (elm.hasAttribute('id') && !shouldIgnore(elm.getAttribute('id'))) {
					var uniqueIdCount = 0;
					for (var n = 0; n < allNodes.length; n++) {
						if (allNodes[n].hasAttribute('id') && allNodes[n].id == elm.id) {
							uniqueIdCount++;
						}
						if (uniqueIdCount > 1) {
							break;
						}
					}
					if (uniqueIdCount == 1) {
						segs.unshift('//*[@id="' + elm.getAttribute('id') + '"]');
						return segs.join('/');
					} else {
						segs.unshift(elm.localName.toLowerCase() + '[@id="' + elm.getAttribute('id') + '"]');
					}
					// } else if (elm.hasAttribute('class')) {
					// 	segs.unshift(elm.localName.toLowerCase() + '[@class="' + elm.getAttribute('class') + '"]');
				} else {
					for (i = 1, sib = elm.previousSibling; sib; sib = sib.previousSibling) {
						if (sib.localName == elm.localName) i++;
					}
					if (i > 1) {
						segs.unshift(elm.localName.toLowerCase() + '[' + i + ']');
					} else {
						segs.unshift(elm.localName.toLowerCase());
					}
				}
			}
			return segs.length ? '/' + segs.join('/') : null;
		};

		const transformEvent = (e, element) => {
			let xpath = createXPathFromElement(element);
			if (e.type === 'click' && xpath.indexOf('/svg') !== -1) {
				const newXpath = xpath.replace(/^(.*button.*)\/svg.*$/, '$1');
				if (newXpath !== xpath) {
					// replaced
					let parent = element;
					while (parent.tagName !== 'BUTTON') {
						parent = parent.parentElement;
					}
					element = parent;
					xpath = newXpath;
				}
			}

			return {
				// keys
				altKey: e.altKey,
				ctrlKey: e.ctrlKey,
				metaKey: e.metaKey,
				shiftKey: e.shiftKey,
				// mouse buttons
				button: e.button,
				buttons: e.buttons,
				detail: e.detail,
				/** positions */
				clientX: e.clientX,
				clientY: e.clientY,
				pageX: e.pageX,
				pageY: e.pageY,
				screenX: e.screenX,
				screenY: e.screenY,
				scrollTop: element === document ? document.documentElement.scrollTop : element.scrollTop,
				scrollLeft: element === document ? document.documentElement.scrollLeft : element.scrollLeft,
				timeStamp: e.timeStamp,
				type: e.type,
				// event source. true: generated by user action; false: generated by scripts
				isTrusted: e.isTrusted,
				value: e.type !== 'keydown' ? element.value : e.key,
				// computed
				path: xpath,
				target:
					element === document
						? 'document'
						: `<${element.tagName.toLowerCase()} ${element
								.getAttributeNames()
								.map(name => `${name}="${element.getAttribute(name)}"`)
								.join(' ')}>`
				// bubbles: e.bubbles,
				// cancelBubble: e.cancelBubble,
				// cancelable: e.cancelable,
				// composed: e.composed,
				// currentTarget: e.currentTarget && e.currentTarget.outerHTML,
				// defaultPrevented: e.defaultPrevented,
				// eventPhase: e.eventPhase,
				// fromElement: e.fromElement && e.fromElement.outerHTML,
				// layerX: e.layerX,
				// layerY: e.layerY,
				// movementX: e.movementX,
				// movementY: e.movementY,
				// offsetX: e.offsetX,
				// offsetY: e.offsetY,
				// relatedTarget: e.relatedTarget && e.relatedTarget.outerHTML,

				// sourceCapabilities: e.sourceCapabilities && e.sourceCapabilities.toString(),
				// toElement: e.toElement && e.toElement.outerHTML,
				// view: e.view && e.view.toString(),
				// which: e.which,
				// x: e.x,
				// y: e.y,
			};
		};
		let scrollTimeoutHandle;
		const eventHandler = e => {
			if (!e) {
				return;
			}
			if (['STYLE'].includes(e.target && e.target.tagName)) {
				// inline style tag, ignored
				return;
			}
			if (e.type === 'keydown' && e.key !== 'Enter') {
				//just record Enter
				return;
			}

			const mask = document.getElementById('$lh-mask');
			const isOnMask = e.target === mask;
			if (isOnMask && e.type !== 'click') {
				// on pick dom mode, only click is cared,
				// otherwise ignored
				return;
			}

			let element = e.target;
			if (isOnMask) {
				document.body.removeChild(mask);
				const { clientX, clientY } = event;
				const elements = document.elementsFromPoint(clientX, clientY);
				if (elements.length > 1) {
					element = elements[1];
				}
			}

			const data = transformEvent(e, element);
			data.uuid = window.$lhUuid;
			if (e.type === 'scroll') {
				if (scrollTimeoutHandle) {
					clearTimeout(scrollTimeoutHandle);
				}
				scrollTimeoutHandle = setTimeout(() => {
					window.$lhRecordEvent(JSON.stringify(data), isOnMask);
					scrollTimeoutHandle = null;
				}, 100);
			} else if (
				e.type === 'change' &&
				element.tagName === 'INPUT' &&
				(element.getAttribute('type') || '').toLowerCase() === 'file'
			) {
				// catch upload file
				const file = element.files[0];
				if (file) {
					const reader = new FileReader();
					reader.onload = () => {
						data.file = reader.result;
						window.$lhRecordEvent(JSON.stringify(data), isOnMask);
					};
					reader.readAsDataURL(file);
				}
			} else if (
				element.tagName === 'INPUT' &&
				['checkbox', 'radio'].indexOf((element.getAttribute('type') || '').toLowerCase()) != -1
			) {
				// record checked
				data.checked = element.checked;
				window.$lhRecordEvent(JSON.stringify(data), isOnMask);
			} else {
				window.$lhRecordEvent(JSON.stringify(data), isOnMask);
			}
		};

		window.$lhGetUuid().then(uuid => {
			window.$lhUuid = uuid;
		});

		Object.values({
			CLICK: 'click',
			// DBLCLICK: 'dblclick',
			CHANGE: 'change',
			KEYDOWN: 'keydown',
			// SELECT: 'select'
			FOCUS: 'focus',
			SCROLL: 'scroll',
			// onchange:"on-change",
			MOUSE_DOWN: 'mousedown',
			SUBMIT: 'submit'
			// LOAD: 'load',
			// UNLOAD: 'unload',
			// VALUE_CHANGE: 'valuechange'
		}).forEach(eventType => document.addEventListener(eventType, eventHandler, { capture: true }));

		const recordDialogEvent = options => {
			const { message, defaultMessage, returnValue, eventType, dialogType } = options;
			window.$lhRecordEvent(
				JSON.stringify({
					uuid: window.$lhUuid,
					type: eventType,
					dialog: dialogType,
					message,
					defaultMessage,
					returnValue,
					target: 'document',
					url: window.location.href
				}),
				false
			);
		};
		// take over native dialog, 4 types: alert, prompt, confirm and beforeunload
		//
		const nativeAlert = window.alert;
		window.alert = message => {
			recordDialogEvent({ message, eventType: 'dialog-open', dialogType: 'alert' });
			nativeAlert(message);
			recordDialogEvent({ message, eventType: 'dialog-close', dialogType: 'alert' });
		};
		const nativeConfirm = window.confirm;
		window.confirm = message => {
			recordDialogEvent({ message, eventType: 'dialog-open', dialogType: 'confirm' });
			const ret = nativeConfirm(message);
			recordDialogEvent({ message, eventType: 'dialog-close', dialogType: 'confirm', returnValue: ret });
			return ret;
		};
		const nativePrompt = window.prompt;
		window.prompt = (message, defaultMessage) => {
			recordDialogEvent({ message, defaultMessage, eventType: 'dialog-open', dialogType: 'prompt' });
			const ret = nativePrompt(message, defaultMessage);
			recordDialogEvent({
				message,
				defaultMessage,
				eventType: 'dialog-close',
				dialogType: 'prompt',
				returnValue: ret
			});
			return ret;
		};

		console.log('%c last-hit: %c evaluate on new document end...', 'color:red', 'color:brown');
	};
	// some pages postpones the page created or popup event. so evaluateOnNewDocument doesn't work.
	// in this case, run evaluate for ensuring the god logic should be install into page
	// anyway, monitors cannot be installed twice, so add varaiable $lhGod on window to prevent
	await page.evaluateOnNewDocument(god);
	await page.evaluate(god);
};

const staticResourceTypes = [
	'document',
	'stylesheet',
	'image',
	'media',
	'font',
	'script',
	'texttrack',
	'eventsource',
	'manifest',
	'other'
];
const dynamicResourceTypes = ['xhr', 'fetch', 'websocket'];
const isDynamicResource = resourceType => dynamicResourceTypes.includes(resourceType);
/**
 *
 * @param {Page} page
 * @param {string} flowKey
 * @param {AllPagesCache} allPages
 */
const recordRemoteRequests = async (page, flowKey, allPages) => {
	const sendRecordedEvent = createPageWindowEventRecorder(flowKey);
	page.on('requestfinished', async request => {
		const url = request.url();
		const response = request.response();
		const resourceType = request.resourceType();

		if (isDynamicResource(resourceType)) {
			// dynamic resources
			const sendEvent = body => {
				try {
					sendRecordedEvent(
						JSON.stringify({
							type: 'ajax',
							uuid: allPages.findUuidByPage(page),
							request: {
								url,
								method: request.method(),
								headers: request.headers(),
								body: request.postData(),
								resourceType
							},
							response: {
								statusCode: response.status(),
								statusMessage: response.statusText(),
								headers: response.headers(),
								body
							}
						})
					);
				} catch (err) {
					console.error(`Failed getting data from: ${url}`);
					console.error(err);
				}
			};
			try {
				sendEvent(await response.text());
			} catch {
				setTimeout(async () => {
					try {
						sendEvent(await response.text());
					} catch {
						sendEvent();
					}
				}, 1000);
			}
		} else {
			// static resource
			// IMPORTANT IGNORED NOW, BECAUSE OF PREFORMANCE ISSUE IN RENDERERING
			// try {
			// 	sendRecordedEvent(
			// 		JSON.stringify({
			// 			type: 'resource-load',
			// 			request: { url, method: request.method(), resourceType },
			// 			response: {
			// 				statusCode: response.status(),
			// 				statusMessage: response.statusText()
			// 			}
			// 		})
			// 	);
			// } catch (err) {
			// 	console.error(`Failed getting data from: ${url}`);
			// 	console.error(err);
			// }
		}
	});
	page.on('requestfailed', async request => {
		const url = request.url();
		const resourceType = request.resourceType();

		if (isDynamicResource(resourceType)) {
			// dynamic resources
			try {
				sendRecordedEvent(
					JSON.stringify({
						type: 'ajax',
						uuid: allPages.findUuidByPage(page),
						failed: true,
						request: {
							url,
							method: request.method(),
							headers: request.headers(),
							body: request.postData(),
							resourceType
						}
					})
				);
			} catch (err) {
				console.error(`Failed getting data from: ${url}`);
				console.error(err);
			}
		} else {
		}
	});
};

/**
 * @param {Page} page
 * @param {string} flowKey
 */
const isAllRelatedPagesClosed = async (page, flowKey) => {
	const allPages = await page.browser().pages();
	return (
		allPages
			.filter(p => page !== p)
			.filter(async p => {
				const key = await page.evaluate(() => window.$lhGetFlowKey());
				return key === flowKey;
			}).length === 0
	);
};
/**
 *
 * @param {Page} page
 * @param {{device, flowKey}} options
 * @param {AllPagesCache} allPages
 */
const controlPage = async (page, options, allPages) => {
	const { device, flowKey } = options;
	const sendRecordedEvent = createPageWindowEventRecorder(flowKey);
	await exposeFunctionToPage(page, flowKey, allPages);
	await installListenersOnPage(page, flowKey);
	await page.emulate(device);
	await page.emulateMedia('screen');
	const setBackground = () => (document.documentElement.style.backgroundColor = 'rgba(25,25,25,0.8)');
	await page.evaluate(setBackground);

	page.on('load', async () => {
		await page.evaluate(setBackground);
	});
	page.on('close', async () => {
		// RESEARCH already closed? seems like this.
		// traverse all pages to check all related pages were closed or not
		const allClosed = isAllRelatedPagesClosed(page, flowKey);
		const uuid = allPages.removeByPage(page);
		if (uuid) {
			sendRecordedEvent(JSON.stringify({ type: 'page-closed', url: page.url(), allClosed, uuid }));
		}
	});
	// page created by window.open or anchor
	page.on('popup', async newPage => {
		console.log('page event popup caught');
		if (!allPages.exists(newPage)) {
			// not found in pages
			const uuid = uuidv4();
			allPages.add(uuid, newPage);
			allPages.prepare(uuid, async () => {
				await controlPage(newPage, { device, flowKey }, allPages);
			});
			const base64 = await captureScreenshot(newPage);
			sendRecordedEvent(JSON.stringify({ type: 'page-created', url: newPage.url(), image: base64, uuid }));
		}
	});
	// use scripts interception
	page.on('dialog', async dialog => {
		console.log(`page event dialog caught`);
		if (dialog.type() === 'beforeunload') {
			const base64 = await captureScreenshot(page);
			const uuid = allPages.findUuidByPage(page);
			sendRecordedEvent(
				JSON.stringify({ type: 'dialog-open', dialog: 'beforeunload', url: page.url(), image: base64, uuid })
			);
		}
	});
	page.on('pageerror', async () => {
		console.log(`page event pageerror caught`);
		const base64 = await captureScreenshot(page);
		const uuid = allPages.findUuidByPage(page);
		sendRecordedEvent(JSON.stringify({ type: 'page-error', url: page.url(), image: base64, uuid }));
	});
};

const browsers = {};
const launch = () => {
	ipcMain.on('launch-puppeteer', (event, arg) => {
		(async () => {
			const { url, device, flowKey, uuid } = arg;
			const {
				viewport: { width, height }
			} = device;
			const browserArgs = [];
			browserArgs.push(`--window-size=${width},${height + 150}`);
			browserArgs.push('--disable-infobars');
			// browserArgs.push('--use-mobile-user-agent');

			// create browser
			const browser = await puppeteer.launch({
				headless: false,
				executablePath: getChromiumExecPath(),
				args: browserArgs
			});
			// cache browser on global
			browsers[flowKey] = browser;
			// check which page will be used
			const pages = await browser.pages();
			if (pages != null && pages.length > 0) {
				await pages[0].close();
			}
			const page = await browser.newPage();
			pages.push(page);
			// give uuid to pages
			const allPages = new AllPagesCache();
			allPages.add(uuid, page);

			const sendRecordedEvent = createPageWindowEventRecorder(flowKey);
			browser.on('disconnected', () => {
				sendRecordedEvent(JSON.stringify({ type: 'end' }));
			});
			browser.on('targetcreated', async newTarget => {
				if (newTarget.type() === 'page') {
					console.log('browser event target created caught');
					const newPage = await newTarget.page();
					if (!allPages.exists(newPage)) {
						// not found in pages
						const uuid = uuidv4();
						allPages.add(uuid, newPage);
						allPages.prepare(uuid, async () => {
							await controlPage(newPage, { device, flowKey }, allPages);
						});
						const base64 = await captureScreenshot(newPage);
						sendRecordedEvent(
							JSON.stringify({ type: 'page-created', url: newPage.url(), image: base64, uuid })
						);
					}
				}
			});
			browser.on('targetchanged', async target => {
				if (target.type() === 'page') {
					console.log('browser event target changed caught');
					// RESEARCH the url is old when target changed event is catched, so must wait the new url.
					// don't know the mechanism
					const page = await target.page();
					const uuid = allPages.findUuidByPage(page);
					const url = page.url();
					allPages.prepare(uuid, async () => {
						await controlPage(page, { device, flowKey }, allPages);
					});
					sendRecordedEvent(JSON.stringify({ type: 'page-switched', url, uuid }));
					let times = 0;
					const handle = () => {
						setTimeout(() => {
							times++;
							const anUrl = page.url();
							if (url === anUrl) {
								if (times < 10) {
									// max 10 times
									handle();
								}
							} else {
								sendRecordedEvent(JSON.stringify({ type: 'page-switched', url: anUrl, uuid }));
							}
						}, 100);
					};
					handle();
				}
			});
			browser.on('targetdestroyed', async target => {
				if (target.type() === 'page') {
					console.log('browser event target destroyed caught');
					const page = await target.page();
					const allClosed = isAllRelatedPagesClosed(page, flowKey);
					const uuid = allPages.removeByPage(page);
					if (uuid) {
						sendRecordedEvent(JSON.stringify({ type: 'page-closed', url: page.url(), uuid, allClosed }));
					}
				}
			});

			await recordRemoteRequests(page, flowKey, allPages);
			await page.goto(url, { waitUntil: 'domcontentloaded' });
			allPages.prepare(uuid, async () => {
				await controlPage(page, { device, flowKey }, allPages);
			});
			try {
				await page.waitForNavigation({ waitUntil: 'domcontentloaded' });
			} catch (e) {
				console.error('Failed to wait for navigation dom content loaded.');
				console.error(e);
			}
		})();
	});
	const disconnectPuppeteer = async (flowKey, close) => {
		const browser = browsers[flowKey];
		try {
			await browser.disconnect();
		} catch (e) {
			console.error('Failed to disconnect from brwoser.');
			console.error(e);
		}
		if (close) {
			try {
				await browser.close();
				delete browsers[flowKey];
			} catch (e) {
				console.error('Failed to close brwoser.');
				console.error(e);
			}
		}
	};
	ipcMain.on('disconnect-puppeteer', (event, arg) => {
		(async () => {
			const { flowKey } = arg;
			await disconnectPuppeteer(flowKey);
		})();
	});
	ipcMain.on('abolish-puppeteer', (event, arg) => {
		(async () => {
			const { flowKey } = arg;
			await disconnectPuppeteer(flowKey, true);
		})();
	});
	ipcMain.on('capture-screen', (event, arg) => {
		(async () => {
			const { flowKey, uuid } = arg;
			const browser = browsers[flowKey];
			if (browser == null) {
				event.reply(`screen-captured-${flowKey}`, { error: 'Browser not found.' });
				return;
			}
			const pages = await browser.pages();
			const page = pages.find(async page => {
				return uuid === (await page.evaluate(() => window.$lhGetUuid()));
			});
			if (page == null) {
				event.reply(`screen-captured-${flowKey}`, { error: 'Page not found.' });
			} else {
				try {
					const base64 = await page.screenshot({ encoding: 'base64' });
					event.reply(`screen-captured-${flowKey}`, { image: base64 });
				} catch (e) {
					console.error(e);
					event.reply(`screen-captured-${flowKey}`, { error: e.message });
				}
			}
		})();
	});
	ipcMain.on('start-pick-dom', (event, arg) => {
		(async () => {
			const { flowKey, uuid } = arg;
			const browser = browsers[flowKey];
			if (browser == null) {
				event.reply('dom-on-page-picked', { error: 'browser not found.' });
				return;
			}
			const pages = await browser.pages();
			const page = pages.find(async page => {
				return uuid === (await page.evaluate(() => window.$lhGetUuid()));
			});
			if (page == null) {
				event.reply('dom-on-page-picked', { error: 'page not found.' });
			} else {
				await page.evaluate(() => {
					const mask = document.createElement('div');
					mask.id = '$lh-mask';
					mask.style.position = 'fixed';
					mask.style.top = 0;
					mask.style.left = 0;
					mask.style.bottom = 0;
					mask.style.right = 0;
					mask.style.backgroundColor = 'rgba(0,0,0,0.3)';
					mask.style.zIndex = 9999999;

					const topBorder = document.createElement('div');
					const rightBorder = document.createElement('div');
					const bottomBorder = document.createElement('div');
					const leftBorder = document.createElement('div');
					[topBorder, bottomBorder].forEach(element => (element.style.height = '2px'));
					[rightBorder, leftBorder].forEach(element => (element.style.width = '2px'));
					[topBorder, rightBorder, bottomBorder, leftBorder].forEach(element => {
						element.style.backgroundColor = 'red';
						element.style.position = 'fixed';
						element.style.zIndex = 10000000;
						element.style.transition = 'all 200ms ease';
						mask.appendChild(element);
					});

					mask.addEventListener('mousemove', event => {
						const { clientX, clientY } = event;
						const elements = document.elementsFromPoint(clientX, clientY);
						if (elements.length > 1) {
							const element = elements[1];
							const { top, left, height, width } = element.getBoundingClientRect();
							// console.log(top, left, height, width, element);
							topBorder.style.left = `${left - 6}px`;
							topBorder.style.top = `${top - 6}px`;
							topBorder.style.width = `${width + 12}px`;
							rightBorder.style.left = `${left + width + 4}px`;
							rightBorder.style.top = `${top - 6}px`;
							rightBorder.style.height = `${height + 12}px`;
							bottomBorder.style.left = `${left - 6}px`;
							bottomBorder.style.top = `${top + height + 4}px`;
							bottomBorder.style.width = `${width + 12}px`;
							leftBorder.style.left = `${left - 6}px`;
							leftBorder.style.top = `${top - 6}px`;
							leftBorder.style.height = `${height + 12}px`;
						}
					});
					document.body.appendChild(mask);
				});
				await page.bringToFront();
			}
		})();
	});
};

const destory = () => {
	console.info('destory all puppeteer browsers.');
	Object.keys(browsers).forEach(async key => {
		console.info(`destory puppeteer browser[${key}]`);
		const browser = browsers[key];
		delete browsers[key];
		try {
			await browser.disconnect();
		} catch {
			// ignore
		}
		try {
			await browser.close();
		} catch {
			// ignore
		}
	});
};

module.exports = { initialize: () => launch(), destory };
