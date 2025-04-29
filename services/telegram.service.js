import { Telegraf, Markup } from 'telegraf';
import { PrismaClient } from '@prisma/client';
import ConversationService from '#services/conversation.service.js';
import { createLogger } from '#utils/logger.js';

/**
 * Enhanced TelegramBotService with robust formatting and WOW factor visuals
 * Designed to work reliably with ConversationService JSON responses
 */
class TelegramBotService {
	constructor(token) {
		this.holdersCache = new Map();
		if(!token) {
			console.error('FATAL: Telegram Bot Token is required!');
			throw new Error('FATAL: Telegram Bot Token is required!');
		}

		this.logger = createLogger({
			name: 'TelegramBotService',
			level: process.env.LOG_LEVEL || 'debug',
			files: process.env.LOG_TO_FILES === 'true',
			console: true,
		});

		try {
			this.bot = new Telegraf(token);
			this.prisma = new PrismaClient();
			this.conversationService = new ConversationService();
			this.logger.info('TelegramBotService instantiated successfully.');
			// Opciones de depuración
			this.debugMode = process.env.DEBUG_MODE === 'true';
			this.logger.info(`Debug mode is ${ this.debugMode ? 'enabled' : 'disabled' }`);
			this.showFullJson = process.env.SHOW_FULL_JSON_RESPONSE === 'true';
			this.logger.info(`Show full JSON response is ${ this.showFullJson ? 'enabled' : 'disabled' }`);
		} catch(error) {
			this.logger.error('FATAL Error during TelegramBotService instantiation', { err: error });
			throw error;
		}
	}

	/**
	 * Initialize bot handlers and middlewares
	 */
	initialize() {
		this.logger.info('Initializing Telegraf handlers...');
		try {
			// Register middleware for logging and diagnostics
			this.bot.use((ctx, next) => {
				this.logger.info('Processing update', {
					update_id: ctx.update?.update_id,
					update_type: ctx.updateType,
					message_type: ctx.message?.type || (ctx.callbackQuery ? 'callback_query' : 'N/A'),
					from_id: ctx.from?.id,
					chat_id: ctx.chat?.id,
				});
				return next();
			});

			// Register command handlers
			this.bot.start(this._handleStart.bind(this));
			this.bot.command('new', this._handleNewConversation.bind(this));
			this.bot.command('help', this._handleHelp.bind(this));
			this.bot.command('data', this._handleDataCommand.bind(this));
			// Register message and callback handlers
			this.bot.on('text', this._processTextMessage.bind(this));
			this.bot.on('callback_query', this._handleCallbackQuery.bind(this));

			// Register error handler
			this.bot.catch(this._handleGlobalError.bind(this));

			this.logger.info('Telegraf handlers initialized successfully.');
		} catch(error) {
			this.logger.error('FATAL Error registering Telegraf handlers', { err: error });
			throw error;
		}
	}

	// Then add the handler method:
	async _handleDataCommand(ctx) {
		try {
			await ctx.sendChatAction('typing');
			const { user, chat, session } = await this._getOrCreateUserAndSession(ctx);

			// Fetch the last message with structured data
			const lastMessage = await this.prisma.message.findFirst({
				where: {
					chatId: chat.id,
					role: 'assistant',
					status: 'Active',
					metas: { path: [ 'structuredData' ], not: null },
				},
				orderBy: { created: 'desc' },
			});

			if(lastMessage && lastMessage.metas?.structuredData) {
				const structuredData = lastMessage.metas.structuredData;
				const formattedData = this._formatStructuredDataSummary(structuredData);

				if(formattedData && formattedData.length > 0) {
					await ctx.reply(`<b>📊 DATA INSIGHTS</b>\n\n${ formattedData }`, {
						parse_mode: 'HTML',
						disable_web_page_preview: true,
						reply_markup: this.createDynamicKeyboard(structuredData),
					});
					return;
				}
			}

			// If no data found
			await ctx.reply('No recent data insights available. Try asking a question about tokens or wallets first.');

		} catch(error) {
			this._handleError(ctx, error, 'data_command');
		}
	}

	/**
	 * Launch the bot and start polling
	 */
	async launch() {
		this.logger.info('Launching Telegram Bot...');
		try {
			// Set bot commands visible in Telegram UI
			await this.bot.telegram.setMyCommands([
				{ command: 'start', description: '🚀 Start the bot' },
				{ command: 'new', description: '✨ Start a new conversation' },
				{ command: 'help', description: '❓ Show help and examples' },
			]);

			await this.bot.launch();
			this.logger.info('✅ Telegram Bot launched successfully and is polling!');

			// Setup graceful shutdown handlers
			process.once('SIGINT', () => this._stopGracefully('SIGINT'));
			process.once('SIGTERM', () => this._stopGracefully('SIGTERM'));
		} catch(error) {
			this.logger.error('FATAL: Failed to launch Telegram Bot!', { err: error });
			await this.prisma.$disconnect().catch(e =>
				this.logger.error('Error disconnecting Prisma during failed launch.', { err: e }),
			);
			process.exit(1);
		}
	}

	/**
	 * Handle /start command
	 */
	async _handleStart(ctx) {
		try {
			await ctx.sendChatAction('typing');
			const { user } = await this._getOrCreateUserAndSession(ctx);
			const name = user.nicename || user.firstname || 'Crypto Explorer';

			const welcomeMessage = `
<b>Welcome to Vybe Vigilante Bot! 👋</b>

I'm your AI assistant for navigating the Solana ecosystem, powered by real-time market data! ⚡️

<i>Here's what I can help you with:</i>
• Analyze tokens, trends, and market movements
• Check wallet balances and transaction history
• Monitor price changes and set alerts
• Compare assets and get investment insights

<b>Just ask me anything about Solana!</b>
      `;

			await ctx.reply(welcomeMessage, {
				parse_mode: 'HTML',
				reply_markup: Markup.inlineKeyboard([
					[ Markup.button.callback('🔍 Explore Top Tokens', 'action:explore_top_tokens') ],
					[ Markup.button.callback('❓ Help & Examples', 'action:show_help') ],
				]),
			});

			this.logger.info('Start message sent.', { userId: user.id });
		} catch(error) {
			this._handleError(ctx, error, 'start_command');
		}
	}

	/**
	 * Handle /new command
	 */
	async _handleNewConversation(ctx) {
		try {
			await ctx.sendChatAction('typing');
			const { chat, user } = await this._getOrCreateUserAndSession(ctx);

			await ctx.reply(
				`<b>✨ New conversation started!</b>\n\nWhat would you like to explore in the Solana ecosystem?`,
				{ parse_mode: 'HTML' },
			);

			this.logger.info('New conversation context acknowledged.', { chatId: chat.id, userId: user.id });
		} catch(error) {
			this._handleError(ctx, error, 'new_command');
		}
	}

	/**
	 * Handle /help command with interactive buttons
	 */
	async _handleHelp(ctx) {
		try {
			await ctx.sendChatAction('typing');
			await this._getOrCreateUserAndSession(ctx);

			const helpMessage = `
<b>🤖 VYBE VIGILANTE BOT - HELP CENTER</b>

Your powerful assistant for navigating Solana with real-time data!

<pre>
┏━━━━━━━━━━━━━━━━━━━━━━━━┓
┃  🚀 VYBE VIGILANTE 🚀  ┃
┃  Your Solana Assistant  ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━┛
</pre>

<i>Select a category or try an example:</i>
      `;

			// Create help categories keyboard
			const keyboard = Markup.inlineKeyboard([
				// Categories
				[
					Markup.button.callback('🔍 Tokens', 'help:tokens'),
					Markup.button.callback('📊 Wallets', 'help:wallets'),
					Markup.button.callback('🔔 Alerts', 'help:alerts'),
				],
				// Examples
				[
					Markup.button.callback('📈 SOL Price?', 'example:sol_price'),
					Markup.button.callback('💡 Token Recommendations', 'example:recommend_tokens'),
				],
				// Commands
				[ Markup.button.callback('⚙️ View Commands', 'help:commands') ],
			]);

			await ctx.reply(helpMessage, {
				parse_mode: 'HTML',
				reply_markup: keyboard.reply_markup,
				disable_web_page_preview: true,
			});

			this.logger.info('Help message sent with interactive buttons');
		} catch(error) {
			this._handleError(ctx, error, 'help_command');
		}
	}

	/**
	 * Process incoming text messages
	 */
	/**
	 * Process incoming text messages
	 */
	async _processTextMessage(ctx) {
		const messageText = ctx.message?.text?.trim();
		if(!messageText) {
			this.logger.warn('Received message without text content', { update_id: ctx.update.update_id });
			return;
		}

		// Ignore commands handled elsewhere
		if(messageText.startsWith('/')) {
			this.logger.info('Ignoring command in text handler', { text: messageText });
			return;
		}

		this.logger.info('Processing text message...', {
			telegramId: ctx.from?.id,
			chatId: ctx.chat?.id,
			textLength: messageText.length,
		});

		try {
			// Show typing indicator
			await ctx.sendChatAction('typing');

			// Get user context
			const { user, chat, session } = await this._getOrCreateUserAndSession(ctx);
			if(!user || !session || !chat) {
				throw new Error('Failed to establish user/session/chat context.');
			}

			this.logger.info('Sending message to ConversationService', {
				userId: user.id,
				chatId: chat.id,
				messagePreview: messageText.substring(0, 50) + (messageText.length > 50 ? '...' : ''),
			});

			// Initial progress message
			const progressMsg = await ctx.reply('⏳ <b>Processing your request...</b>', { parse_mode: 'HTML' });

			// Create progress callback function
			const progressCallback = async (stage, detail) => {
				try {
					let stageEmoji = '⏳';
					let stageTitle = stage.toUpperCase();

					switch(stage) {
						case 'setup':
							stageEmoji = '🔄';
							stageTitle = 'INITIALIZING';
							break;
						case 'memory_consultation':
							stageEmoji = '🧠';
							stageTitle = 'CHECKING MEMORY';
							break;
						case 'token_resolution':
							stageEmoji = '🔍';
							stageTitle = 'IDENTIFYING TOKENS';
							break;
						case 'main_consultation':
							stageEmoji = '⚙️';
							stageTitle = 'PROCESSING REQUEST';
							break;
						case 'executing_tools':
							stageEmoji = '🛠️';
							stageTitle = 'EXECUTING ACTIONS';
							break;
						case 'synthesis':
							stageEmoji = '📊';
							stageTitle = 'ANALYZING RESULTS';
							break;
						case 'finalizing':
							stageEmoji = '✨';
							stageTitle = 'FINALIZING RESPONSE';
							break;
						case 'complete':
							stageEmoji = '✅';
							stageTitle = 'COMPLETED';
							break;
						case 'error':
							stageEmoji = '❌';
							stageTitle = 'ERROR';
							break;
					}

					// Update progress message
					await ctx.telegram.editMessageText(
						ctx.chat.id,
						progressMsg.message_id,
						null,
						`${ stageEmoji } <b>${ stageTitle }</b>\n${ detail ? `\n${ this._escapeHtml(detail) }` : '' }`,
						{ parse_mode: 'HTML' },
					).catch(e => {
						// Silently fail on edit errors
						this.logger.warn('Failed to update progress message', { err: e, stage, detail });
					});

					// Maintain typing indicator for longer operations
					if([ 'main_consultation', 'executing_tools', 'synthesis' ].includes(stage)) {
						await ctx.sendChatAction('typing').catch(() => {});
					}
				} catch(error) {
					this.logger.warn('Error in progress callback', { err: error, stage, detail });
				}
			};

			// Process with ConversationService using progress callback
			const startTime = Date.now();
			const response = await this.conversationService.sendMessage(
				user.id, chat.id, messageText, session.id, progressCallback,
			);

			const duration = Date.now() - startTime;

			this.logger.info('Received response from ConversationService', {
				durationMs: duration,
				chatId: chat.id,
				userId: user.id,
				hasReply: !!response?.assistantMessage?.text,
				actionsExecuted: response?.executedActions?.map(a => a.name) || [],
				hasStructuredData: !!response?.structuredData && Object.keys(response.structuredData).length > 0,
			});

			// Try to delete the progress message now that we have a response
			try {
				await ctx.telegram.deleteMessage(ctx.chat.id, progressMsg.message_id);
			} catch(deleteError) {
				this.logger.warn('Failed to delete progress message', { err: deleteError });
				// Continue even if we can't delete it
			}

			// Show full JSON response in debug mode
			if(this.showFullJson && response) {
				try {
					// Usar función _sendChunkedDebugJson para dividir JSON grande
					await this._sendChunkedDebugJson(ctx, response);
				} catch(error) {
					this.logger.error('Error sending chunked JSON debug response', { err: error });
				}
			}

			// Enviar respuesta usando la función sendEnhancedResponse
			await this.sendEnhancedResponse(ctx, response);

		} catch(error) {
			this._handleError(ctx, error, 'text_message_processing');
		}
	}

	/**
	 * Enviar JSON de depuración en múltiples partes
	 * @param {object} ctx - Telegram context
	 * @param {object} json - JSON object to send
	 */
	async _sendChunkedDebugJson(ctx, json) {
		try {
			const jsonStr = JSON.stringify(json, null, 2);
			const MAX_CHUNK_SIZE = 3500; // Un poco menos que el límite de Telegram para dejar espacio para encabezados

			// Dividir en chunks
			const chunks = [];
			for(let i = 0; i < jsonStr.length; i += MAX_CHUNK_SIZE) {
				chunks.push(jsonStr.substring(i, i + MAX_CHUNK_SIZE));
			}

			// Enviar el encabezado con el total de partes
			await ctx.reply(`⚙️ DEBUG JSON (1/${ chunks.length }) ⚙️`, { parse_mode: 'HTML' });

			// Enviar cada chunk
			for(let i = 0; i < chunks.length; i++) {
				await ctx.reply(
					`<pre><code class="language-json">${ this._escapeHtml(chunks[i]) }</code></pre>`,
					{ parse_mode: 'HTML' },
				);

				// Pequeña pausa para no sobrecargar la API de Telegram
				if(i < chunks.length - 1) {
					await new Promise(resolve => setTimeout(resolve, 500));
				}
			}

			this.logger.info(`Successfully sent chunked JSON debug (${ chunks.length } parts)`);
		} catch(error) {
			this.logger.error('Failed to send chunked debug JSON', { err: error });

			// Último recurso: enviar un mensaje simple
			try {
				await ctx.reply('⚠️ Error al mostrar el JSON completo (demasiado grande)');
			} catch(e) {
				this.logger.error('Catastrophic error handling debug JSON display', { err: e });
			}
		}
	}

	/**
	 * Envía respuesta con formateo mejorado y asegura que los botones aparezcan
	 * @param {object} ctx - Contexto de Telegram
	 * @param {object} response - Respuesta de la conversación
	 */

	/**
	 * Envía respuesta con formateo mejorado, manejando múltiples tipos de datos estructurados.
	 * @param {object} ctx - Contexto de Telegram
	 * @param {object} response - Respuesta de la conversación
	 */
	/**
	 * Envía respuesta con formateo mejorado, manejando múltiples tipos de datos estructurados.
	 * @param {object} ctx - Contexto de Telegram
	 * @param {object} response - Respuesta de la conversación
	 */
	async sendEnhancedResponse(ctx, response) {
		if(!response || !response.assistantMessage || typeof response.assistantMessage.text !== 'string') {
			this.logger.error('[sendEnhancedResponse] Invalid response object or missing assistant message text.', { responseReceived: response });
			try {
				await ctx.reply('I processed your request but had trouble generating a response text. Please try again.');
			} catch(e) {
				this.logger.error('[sendEnhancedResponse] Failed to send fallback error message.', { nestedError: e });
			}
			return;
		}

		this.logger.info('[sendEnhancedResponse] Received response object.', {
			hasStructuredData: !!response.structuredData,
			structuredDataPreview: JSON.stringify(response.structuredData, null, 2).substring(0, 500) + '...',
			assistantMessagePreview: response.assistantMessage.text.substring(0, 100) + '...',
			executedActions: response.executedActions || [],
		});

		try {
			const MAX_MESSAGE_LENGTH = 4000;
			let messageSections = [];
			let logoUrl = null;
			let historyDataFound = null; // Variable para almacenar los datos de historial si se encuentran
			let tokenDataForCard = null; // Variable para almacenar datos de token si se encuentran
			let holdersDataFound = null; // Variable para almacenar datos de holders si se encuentran
			let walletDataFound = null; // NEW: Variable para almacenar datos de wallet si se encuentran
			let walletTimeSeriesFound = null;
			let topTokensDataFound = null;
			let programDetailsFound = null;
			let programActiveUsersFound = null;
			let programRankingFound = null;
			let tokenRecommendationsFound = null;
			let pricePredictionFound = null;
			if(
				// Direct price prediction structure
				(response.structuredData?.tokenSymbol &&
					response.structuredData?.prediction) ||

				(response.structuredData?.data?.tokenSymbol &&
					response.structuredData?.data?.prediction) ||

				// Or check for related action
				response.executedActions?.some(action =>
					typeof action === 'object' &&
					(action.name === 'get_price_prediction'),
				)
			) {
				this.logger.info('[sendEnhancedResponse] Found VALID price prediction data.');
				pricePredictionFound = response.structuredData;
			}
			if(
				// Direct token recommendations structure
				(response.structuredData?.recommendations &&
					Array.isArray(response.structuredData.recommendations)) ||

				(response.structuredData?.data?.recommendations &&
					Array.isArray(response.structuredData.data.recommendations)) ||

				// Or check for related action
				response.executedActions?.some(action =>
					typeof action === 'object' &&
					(action.name === 'recommend_tokens'),
				)
			) {
				this.logger.info('[sendEnhancedResponse] Found VALID token recommendations data.');
				tokenRecommendationsFound = response.structuredData;
			}

			if(
				// Direct program ranking structur
				// Or check for related action
				response.executedActions?.some(action =>
					typeof action === 'object' &&
					(action.name === 'fetch_program_ranking' ||
						action.name === 'get_top_programs'),
				)
			) {
				this.logger.info('[sendEnhancedResponse] Found VALID program ranking data.');
				programRankingFound = response.structuredData;
			}
			if(
				// Direct program active users structure
				(response.structuredData?.programId &&
					(response.structuredData?.activeUsers || response.structuredData?.days)) ||
				(response.structuredData?.data?.programId &&
					(response.structuredData?.data?.activeUsers || response.structuredData?.data?.days)) ||
				// Or check for related action
				response.executedActions?.some(action =>
					typeof action === 'object' &&
					(action.name === 'fetch_program_active_users' ||
						action.name === 'get_program_users'),
				)
			) {
				this.logger.info('[sendEnhancedResponse] Found VALID program active users data.');
				programActiveUsersFound = response.structuredData;
			}
			if(
				// Direct program details structure
				(response.structuredData?.programId && response.structuredData?.details) ||
				(response.structuredData?.data?.programId && response.structuredData?.data?.details) ||
				// Or check for related action
				response.executedActions?.some(action =>
					typeof action === 'object' &&
					(action.name === 'fetch_program_details' ||
						action.name === 'analyze_program'),
				)
			) {
				this.logger.info('[sendEnhancedResponse] Found VALID program details data.');
				programDetailsFound = response.structuredData;
			}

			if(
				// Estructura específica de top tokens
				(response.structuredData?.data?.tokens?.data &&
					Array.isArray(response.structuredData.data.tokens.data) &&
					response.structuredData.data.tokens.data.length > 0) ||
				// O acción ejecutada relacionada
				response.executedActions?.some(action =>
					typeof action === 'object' &&
					(action.name === 'fetch_top_tokens' ||
						action.name === 'recommend_tokens'),
				)
			) {
				this.logger.info('[sendEnhancedResponse] Found VALID top tokens data.');
				topTokensDataFound = response.structuredData;
			}

			if(
				// Estructura de datos específica de time series
				(response.structuredData?.data?.timeSeriesData ||
					(response.structuredData?.data?.wallet && response.structuredData?.data?.days)) ||
				// Acciones ejecutadas relacionadas con time series
				response.executedActions?.some(action =>
					typeof action === 'object' && action.name === 'get_wallet_tokens_time_series',
				)
			) {
				this.logger.info('[sendEnhancedResponse] Found VALID wallet time series data.');
				walletTimeSeriesFound = response.structuredData;
			}

			// Check for wallet data - ENHANCED detection with detailed logging
			if(response.structuredData?.data?.wallet ||
				(response.structuredData?.data?.tokens &&
					response.structuredData?.data?.tokens?.ownerAddress) ||
				(response.executedActions?.some(action =>
					typeof action === 'object' &&
					(action.name === 'fetch_wallet_data' ||
						action.name === 'fetch_wallet_tokens' ||
						action.name === 'fetch_wallet_nfts')))) {

				this.logger.info('[sendEnhancedResponse] Found VALID wallet data.');
				walletDataFound = response.structuredData;
			}

			// Check for holders data
			if(response.structuredData?.data?.holdersData?.data &&
				Array.isArray(response.structuredData.data.holdersData.data) &&
				response.structuredData.data.holdersData.data.length > 0) {
				holdersDataFound = response.structuredData;
				this.logger.info('[sendEnhancedResponse] Found VALID token holders data.');
			}

			// Verificar si hay datos de historial VÁLIDOS (en cualquiera de las dos estructuras posibles)
			if(response.structuredData?.data?.priceData?.data && Array.isArray(response.structuredData.data.priceData.data) && response.structuredData.data.priceData.data.length > 0) {
				historyDataFound = response.structuredData.data; // Estructura anidada
				this.logger.info('[sendEnhancedResponse] Found VALID price history data (nested structure).');
			} else if(response.structuredData?.priceData?.data && Array.isArray(response.structuredData.priceData.data) && response.structuredData.priceData.data.length > 0) {
				historyDataFound = response.structuredData; // Estructura plana
				this.logger.info('[sendEnhancedResponse] Found VALID price history data (flat structure).');
			}

			// Verificar si hay datos de token VÁLIDOS (objeto, no solo string, y diferente de los datos de historial)
			if(response.structuredData?.token && typeof response.structuredData.token === 'object') {
				// Solo consideramos esto como datos de token si NO encontramos datos de historial válidos
				// o si la estructura de historial no contenía también el objeto token (evitar duplicados)
				if(!historyDataFound || !historyDataFound.token) {
					tokenDataForCard = response.structuredData.token;
					this.logger.info('[sendEnhancedResponse] Found VALID token object data.');
				} else {
					this.logger.info('[sendEnhancedResponse] Token object data present but history data takes precedence for card formatting.');
				}
			}

			if(topTokensDataFound) {
				this.logger.info('[sendEnhancedResponse] Formatting top tokens section.');
				const topTokensCard = this._formatTopTokensInfo(topTokensDataFound);
				if(topTokensCard) {
					messageSections.push(topTokensCard);
					this.logger.info('[sendEnhancedResponse] Top tokens section added.');
				} else {
					this.logger.warn('[sendEnhancedResponse] _formatTopTokensInfo returned null or empty.');
					messageSections.push('<i>(Could not format top tokens data)</i>');
				}
			}
			if(programActiveUsersFound) {
				this.logger.info('[sendEnhancedResponse] Formatting program active users section.');
				const usersInfo = this._formatProgramActiveUsersInfo(programActiveUsersFound);

				if(usersInfo) {
					messageSections.push(usersInfo);
					this.logger.info('[sendEnhancedResponse] Program active users section added.');
				} else {
					this.logger.warn('[sendEnhancedResponse] _formatProgramActiveUsersInfo returned null or empty.');
					messageSections.push('<i>(Could not format program active users data)</i>');
				}
			}
			// --- Paso 2: Construir las secciones del mensaje ---
			if(walletTimeSeriesFound) {
				this.logger.info('[sendEnhancedResponse] Formatting wallet time series section.');
				const timeSeriesCard = this._formatWalletTimeSeriesInfo(walletTimeSeriesFound);
				if(timeSeriesCard) {
					messageSections.push(timeSeriesCard);
					this.logger.info('[sendEnhancedResponse] Wallet time series section added.');
				} else {
					this.logger.warn('[sendEnhancedResponse] _formatWalletTimeSeriesInfo returned null or empty.');
					messageSections.push('<i>(Could not format wallet historical data)</i>');
				}
			}
			// NEW: Wallet Data Section (if we found valid wallet data)
			if(walletDataFound) {
				this.logger.info('[sendEnhancedResponse] Formatting wallet section.');
				const walletCard = this._formatWalletInfo(walletDataFound);
				if(walletCard) {
					messageSections.push(walletCard);
					this.logger.info('[sendEnhancedResponse] Wallet section added.');
				} else {
					this.logger.warn('[sendEnhancedResponse] _formatWalletInfo returned null or empty.');
					messageSections.push('<i>(Could not format wallet details)</i>');
				}
			}

			// Sección de Información del Token (si encontramos datos válidos para ella)
			if(tokenDataForCard) {
				this.logger.info('[sendEnhancedResponse] Formatting token info section.');
				const tokenInfo = this._formatTokenInfo(tokenDataForCard); // Pasar el objeto token
				if(tokenInfo?.card) {
					messageSections.push(tokenInfo.card);
					logoUrl = tokenInfo.logoUrl; // Guardar logo
					this.logger.info('[sendEnhancedResponse] Token info section added.', { obtainedLogoUrl: logoUrl });
				} else {
					this.logger.warn('[sendEnhancedResponse] _formatTokenInfo returned null/invalid for token object.');
					messageSections.push('<i>(Could not format detailed token info)</i>');
				}
			} else if(response.structuredData?.token && typeof response.structuredData.token !== 'object') {
				// Log si encontramos la clave 'token' pero no es un objeto (como en el último log)
				this.logger.warn('[sendEnhancedResponse] Found "token" key in structuredData, but it is not an object. Skipping token card.', { tokenValue: response.structuredData.token });
			}

			// Sección de Historial de Precios (si encontramos datos válidos para ella)
			if(historyDataFound) {
				this.logger.info('[sendEnhancedResponse] Formatting price history section.');
				const historyCard = await this._formatPriceHistoryInfo(historyDataFound); // Pasar el objeto correcto
				if(historyCard) {
					messageSections.push(historyCard);
					this.logger.info('[sendEnhancedResponse] Price history section added.');
				} else {
					this.logger.warn('[sendEnhancedResponse] _formatPriceHistoryInfo returned null or empty.');
					messageSections.push('<i>(Could not format price history details)</i>');
				}
			}

			// Token Holders Section (if we found valid data)
			if(holdersDataFound) {
				this.logger.info('[sendEnhancedResponse] Formatting token holders section.');
				const holdersCard = this._formatTokenHoldersInfo(holdersDataFound);
				if(holdersCard) {
					messageSections.push(holdersCard);
					this.logger.info('[sendEnhancedResponse] Token holders section added.');
				} else {
					this.logger.warn('[sendEnhancedResponse] _formatTokenHoldersInfo returned null or empty.');
					messageSections.push('<i>(Could not format holders data)</i>');
				}
			}
			if(programRankingFound) {
				this.logger.info('[sendEnhancedResponse] Formatting program ranking section.');
				const rankingInfo = this._formatProgramRankingInfo(programRankingFound);

				if(rankingInfo) {
					messageSections.push(rankingInfo);
					this.logger.info('[sendEnhancedResponse] Program ranking section added.');
				} else {
					this.logger.warn('[sendEnhancedResponse] _formatProgramRankingInfo returned null or empty.');
					messageSections.push('<i>(Could not format program ranking data)</i>');
				}
			}
			if(programDetailsFound) {
				this.logger.info('[sendEnhancedResponse] Formatting program details section.');
				const programInfo = this._formatProgramDetailsInfo(programDetailsFound);

				if(programInfo) {
					// Handle either string or object return value
					if(typeof programInfo === 'string') {
						messageSections.push(programInfo);
						this.logger.info('[sendEnhancedResponse] Program details section added.');
					} else if(programInfo.card) {
						messageSections.push(programInfo.card);
						// If program has a logo, save it for possible display
						if(programInfo.logoUrl) {
							logoUrl = programInfo.logoUrl;
							this.logger.info('[sendEnhancedResponse] Program details section with logo added.', {
								logoUrl: logoUrl,
							});
						} else {
							this.logger.info('[sendEnhancedResponse] Program details section added (no logo).');
						}
					} else {
						this.logger.warn('[sendEnhancedResponse] Invalid return value from _formatProgramDetailsInfo.');
						messageSections.push('<i>(Could not format program details)</i>');
					}
				} else {
					this.logger.warn('[sendEnhancedResponse] _formatProgramDetailsInfo returned null or empty.');
					messageSections.push('<i>(Could not format program details)</i>');
				}
			}
			// Sección del Texto del Asistente (siempre añadir si no está vacío)
			const enhancedText = this._enhanceTextFormatting(response.assistantMessage.text);
			if(enhancedText.trim().length > 0) {
				// Añadir siempre, separado claramente
				messageSections.push(enhancedText);
				this.logger.info('[sendEnhancedResponse] Assistant text section added.');
			} else {
				this.logger.info('[sendEnhancedResponse] Assistant text is empty, not adding section.');
			}

			// --- Paso 3: Unir, Truncar y Enviar ---
			let finalMessage = messageSections.join('\n\n' + '─'.repeat(25) + '\n\n');

			// Eliminar separador inicial si solo hay una sección
			if(messageSections.length <= 1) {
				finalMessage = messageSections.join(''); // Sin separador si solo hay 0 o 1 sección
			}

			if(finalMessage.length > MAX_MESSAGE_LENGTH) {
				const truncationMsg = '\n\n<i>⚠️ Message truncated due to length limits...</i>';
				finalMessage = finalMessage.substring(0, MAX_MESSAGE_LENGTH - truncationMsg.length) + truncationMsg;
				this.logger.warn('[sendEnhancedResponse] Final message truncated due to length.', { originalLength: finalMessage.length + truncationMsg.length });
			}

			// Teclado y Opciones
			const inlineKeyboard = this.createDynamicKeyboard(response.structuredData, response.executedActions);
			const options = {
				parse_mode: 'HTML',
				disable_web_page_preview: !logoUrl,
			};

			// Opción 1: Si inlineKeyboard es el objeto completo con reply_markup
			if(inlineKeyboard && inlineKeyboard.reply_markup) {
				options.reply_markup = inlineKeyboard.reply_markup;
			}
			this.logger.info('[sendEnhancedResponse] Keyboard structure:', {
				keyboardType: typeof inlineKeyboard,
				hasReplyMarkup: inlineKeyboard && inlineKeyboard.reply_markup,
				isArray: Array.isArray(inlineKeyboard),
				keyboardStr: JSON.stringify(inlineKeyboard),
			});
			this.logger.info('[sendEnhancedResponse] Base send options:', { options: JSON.stringify(options) });

			// Añadir Link de Logo
			this.logger.info('[sendEnhancedResponse] Checking if logoUrl exists for adding invisible link.', {
				logoUrlExists: !!logoUrl,
				logoUrlValue: logoUrl,
			});
			if(logoUrl && typeof logoUrl === 'string' && logoUrl.startsWith('http')) {
				finalMessage = `<a href="${ this._escapeHtml(logoUrl) }">​</a>${ finalMessage }`;
				this.logger.info('[sendEnhancedResponse] Added invisible link for logo preview.');
			} else if(logoUrl) {
				this.logger.warn('[sendEnhancedResponse] logoUrl exists but seems invalid, not adding link.', { logoUrlValue: logoUrl });
			}

			// Enviar Mensaje
			this.logger.info('[sendEnhancedResponse] Final message and options before sending:', {
				finalMessagePreview: finalMessage.substring(0, 300) + '...',
				finalOptions: JSON.stringify(options),
			});
			await ctx.reply(finalMessage, options);

			this.logger.info('[sendEnhancedResponse] Enhanced response sent successfully.', {
				chatId: ctx.chat?.id,
				userId: ctx.from?.id,
				hasLogo: !!logoUrl,
				hasButtons: !!inlineKeyboard,
				messageLength: finalMessage.length,
			});

		} catch(error) {
			this.logger.error('[sendEnhancedResponse] Error sending enhanced response', {
				err: error, errorMessage: error.message, errorCode: error.code, errorDescription: error.description,
				stackPreview: error.stack?.substring(0, 400),
				responseInputPreview: JSON.stringify(response, null, 2).substring(0, 500) + '...',
			});
			try {
				this.logger.warn('[sendEnhancedResponse] Attempting fallback response (plain text).');
				const fallbackText = this._stripHtml(response.assistantMessage.text);
				await ctx.reply(fallbackText);
			} catch(fallbackError) {
				this.logger.error('[sendEnhancedResponse] Catastrophic failure: Fallback reply also failed.', {
					originalError: error.message, fallbackError: fallbackError.message,
				});
			}
		}
	}

	/**
	 * Formato mejorado para visualización épica del token que incluye logo visible
	 * @param {object} token - Datos del token
	 * @returns {object | null} Card y logo URL, o null si el token es inválido
	 */
	_formatTokenInfo(token) {
		if(!token) {
			// LOG AÑADIDO: Advierte si la función es llamada sin un token válido
			this.logger.warn('[_formatTokenInfo] Called with null or undefined token.');
			return null; // Retorna null si no hay token
		}

		// LOG AÑADIDO: Muestra el objeto token completo que recibe la función
		// Usa JSON.stringify para evitar problemas con objetos complejos en algunos loggers
		this.logger.info('[_formatTokenInfo] Received token data:', { tokenData: JSON.stringify(token, null, 2) });

		try {
			// Extraer datos esenciales
			const symbol = this._escapeHtml(token.symbol || '???');
			const name = this._escapeHtml(token.name || symbol);
			const price = token.price_usd || token.price || 0;
			const change24h = token.price_change_1d || token.price_change_24h || 0;
			const marketCap = token.marketCap || 0;
			const volume = token.volume_24h || 0;
			const address = token.mintAddress || token.address || '';
			const verified = token.verified ? '✓ VERIFIED' : '';
			// LOG AÑADIDO: Guarda la URL del logo ANTES de construir la card
			const logoUrlFromInput = token.logoUrl;

			// Seleccionar emojis y elementos visuales según el rendimiento
			const changeEmoji = change24h >= 5 ? '🚀' : (change24h > 0 ? '📈' : (change24h < -5 ? '💥' : '📉'));
			const changeSign = change24h >= 0 ? '+' : '';
			const changeText = `${ changeSign }${ change24h.toFixed(2) }%`;

			// Construir la card sin usar el logo en línea primero
			let card = '';

			// ENCABEZADO
			card += `🔶🔶🔶 <b>TOKEN SPOTLIGHT</b> 🔶🔶🔶\n\n`;
			card += `<b>🪙 ${ name }</b> (<code>${ symbol }</code>) ${ verified ? '✅' : '' }\n\n`;

			// MÉTRICAS PRINCIPALES
			card += `<b>💰 PRICE:</b> $${ this._formatNumber(price) }\n`;
			card += `<b>${ changeEmoji } 24H CHANGE:</b> <b>${ changeText }</b>\n\n`;

			// MÉTRICAS SECUNDARIAS
			card += `<b>📊 KEY METRICS</b>\n`;
			card += `• Market Cap: <b>$${ this._formatNumber(marketCap, true) }</b>\n`;
			card += `• 24h Volume: <b>$${ this._formatNumber(volume, true) }</b>\n`;

			// Métricas adicionales si están disponibles
			if(token.holders !== undefined && token.holders !== null) { // Chequeo más robusto
				card += `• Holders: <b>${ this._formatNumber(token.holders) }</b>\n`;
			}

			if(token.decimal !== undefined || token.decimals !== undefined) { // Chequeo más robusto
				card += `• Decimals: <b>${ token.decimal || token.decimals }</b>\n`;
			}

			// DIRECCIÓN
			if(address) {
				const shortAddr = address.length > 16 ?
					`${ address.substring(0, 8) }...${ address.substring(address.length - 8) }` : address;

				card += `\n<b>📍 ADDRESS:</b>\n<code>${ shortAddr }</code>\n`;
			}

			// TAGS
			card += `\n${ '━'.repeat(20) }\n`;

			if(token.tags) {
				let tags = token.tags;
				if(typeof tags === 'string') {
					try {
						// Intenta parsear si es un string JSON, si no, lo trata como un solo tag
						if(tags.startsWith('[') || tags.startsWith('{')) {
							tags = JSON.parse(tags);
						} else {
							tags = [ tags ]; // Trátalo como un solo tag si no es JSON
						}
					} catch(e) {
						this.logger.warn('[_formatTokenInfo] Failed to parse token tags string, treating as single tag.', {
							tagsString: token.tags,
							error: e,
						});
						tags = [ token.tags ]; // Fallback a tratarlo como un string simple
					}
				}

				if(Array.isArray(tags) && tags.length > 0) {
					const tagsList = tags.map(tag => `#${ String(tag).replace(/[^a-zA-Z0-9_]/g, '') }`).join(' '); // Asegura que sea string y limpia mejor
					card += `<i>${ tagsList }</i>\n\n`;
				}
			}

			// LOG AÑADIDO: Muestra la URL del logo extraída y lo que se va a retornar
			this.logger.info('[_formatTokenInfo] Extracted logoUrl and returning info.', {
				extractedLogoUrl: logoUrlFromInput,
				returnedCardPreview: card.substring(0, 100) + '...', // Muestra un preview de la card
				returnedLogoUrl: logoUrlFromInput,
			});

			return {
				card: card,
				logoUrl: logoUrlFromInput, // Retorna la URL guardada
			};
		} catch(error) {
			// LOG MEJORADO: Incluye el token de entrada en el log de error
			this.logger.error('[_formatTokenInfo] Error creating token info card', {
				err: error,
				errorMessage: error.message,
				inputToken: JSON.stringify(token, null, 2), // Muestra el token que causó el error
			});
			// Retorna una card básica y null como logo en caso de error
			return {
				card: `<b>${ this._escapeHtml(token.name || token.symbol || 'Token') }</b>\nPrice: $${ this._formatNumber(token.price || token.price_usd || 0) }`,
				logoUrl: null,
			};
		}
	}

	/**
	 * Creates a clean, readable representation of structured data
	 * that works consistently regardless of data size
	 */
	_formatStructuredDataSummary(structuredData) {
		if(!structuredData) return null;

		try {
			let formattedText = '';

			// 1. TOKEN RECOMMENDATIONS
			if(structuredData.recommendations && Array.isArray(structuredData.recommendations)) {
				const tokens = structuredData.recommendations;

				// Header with metadata
				formattedText += `<b>🏆 TOP TOKENS - ${ tokens.length }</b>\n`;
				if(structuredData.criteria) {
					formattedText += `<i>Criteria: <b>${ this._escapeHtml(structuredData.criteria) }</b> | `;
					formattedText += `Risk: <b>${ this._escapeHtml(structuredData.risk_level || 'medium') }</b> | `;
					formattedText += `Timeframe: <b>${ this._escapeHtml(structuredData.timeframe || 'short') }</b></i>\n\n`;
				}

				// Token list with key data
				tokens.forEach((token, index) => {
					const num = index + 1;
					const symbol = this._escapeHtml(token.symbol || '???');
					const name = this._escapeHtml(token.name || symbol);
					const price = token.price_usd || 0;
					const marketCap = token.marketCap || 0;
					const change = token.price_change_1d || token.price_change_24h || 0;

					// Format with emojis as visual indicators (works reliably in Telegram)
					const changeEmoji = change > 1 ? '🚀' : (change > 0 ? '📈' : (change < 0 ? '📉' : '➡️'));

					formattedText += `${ num }. <b><code>${ symbol }</code> - ${ name }</b>\n`;
					formattedText += `   💰 Price: <b>$${ this._formatNumber(price) }</b>\n`;
					formattedText += `   ${ changeEmoji } Change: <b>${ change > 0 ? '+' : '' }${ change.toFixed(2) }%</b>\n`;
					formattedText += `   💼 MCap: <b>$${ this._formatNumber(marketCap, true) }</b>\n`;

					// Only show a divider if not the last item
					if(index < tokens.length - 1) {
						formattedText += `   ────────────────────\n`;
					}
				});
			}

			// 2. SINGLE TOKEN DATA
			else if(structuredData.token) {
				const token = structuredData.token;
				const symbol = this._escapeHtml(token.symbol || '???');
				const name = this._escapeHtml(token.name || symbol);
				const address = token.address || token.mintAddress || '';

				// Header
				formattedText += `<b>📊 TOKEN ANALYSIS: <code>${ symbol }</code></b>\n\n`;

				// Main data
				formattedText += `<b>Name:</b> ${ name }\n`;
				formattedText += `<b>Price:</b> $${ this._formatNumber(token.price_usd || token.price || 0) }\n`;

				// Price changes if available
				if(token.price_change_1d !== undefined) {
					const change = token.price_change_1d;
					const emoji = change > 1 ? '🚀' : (change > 0 ? '📈' : (change < 0 ? '📉' : '➡️'));
					formattedText += `<b>24h Change:</b> ${ emoji } ${ change > 0 ? '+' : '' }${ change.toFixed(2) }%\n`;
				}

				if(token.price_change_7d !== undefined) {
					const change = token.price_change_7d;
					const emoji = change > 5 ? '🚀' : (change > 0 ? '📈' : (change < 0 ? '📉' : '➡️'));
					formattedText += `<b>7d Change:</b> ${ emoji } ${ change > 0 ? '+' : '' }${ change.toFixed(2) }%\n`;
				}

				// Market metrics
				formattedText += `<b>Market Cap:</b> $${ this._formatNumber(token.marketCap || 0, true) }\n`;
				formattedText += `<b>24h Volume:</b> $${ this._formatNumber(token.volume_24h || 0, true) }\n`;

				// Holders if available
				if(token.holders !== undefined) {
					formattedText += `<b>Holders:</b> ${ this._formatNumber(token.holders) }\n`;
				}

				// Address (shortened)
				if(address) {
					const shortAddr = address.length > 16 ?
						`${ address.substring(0, 8) }...${ address.substring(address.length - 8) }` : address;
					formattedText += `<b>Address:</b> <code>${ shortAddr }</code>\n`;
				}
			}

			// 3. WALLET DATA
			else if(structuredData.wallet) {
				const wallet = structuredData.wallet;
				const tokens = structuredData.tokens?.data || [];

				// Header
				formattedText += `<b>💼 WALLET ANALYSIS</b>\n\n`;

				// Wallet address (shortened)
				const shortAddr = wallet.length > 16 ?
					`${ wallet.substring(0, 8) }...${ wallet.substring(wallet.length - 8) }` : wallet;
				formattedText += `<b>Address:</b> <code>${ shortAddr }</code>\n`;

				// Portfolio value if available
				if(structuredData.tokens?.totalTokenValueUsd) {
					formattedText += `<b>Portfolio Value:</b> $${ this._formatNumber(structuredData.tokens.totalTokenValueUsd) }\n`;

					// Change if available
					if(structuredData.tokens.totalTokenValueUsd1dChange !== undefined) {
						const change = structuredData.tokens.totalTokenValueUsd1dChange;
						const emoji = change > 0 ? '📈' : (change < 0 ? '📉' : '➡️');
						formattedText += `<b>24h Change:</b> ${ emoji } ${ change > 0 ? '+' : '' }${ this._formatNumber(change) }\n`;
					}
				}

				// Token count
				formattedText += `<b>Tokens Held:</b> ${ tokens.length || 0 }\n\n`;

				// Top tokens if available
				if(tokens.length > 0) {
					formattedText += `<b>Top Holdings:</b>\n`;

					// Display 3-5 top tokens
					tokens.slice(0, Math.min(tokens.length, 5)).forEach((token, idx) => {
						const symbol = this._escapeHtml(token.symbol || '???');
						const balance = token.balance || 0;
						const value = token.valueUsd || 0;

						formattedText += `${ idx + 1 }. <code>${ symbol }</code>: ${ this._formatNumber(balance) } tokens`;
						if(value > 0) {
							formattedText += ` ($${ this._formatNumber(value) })`;
						}
						formattedText += '\n';
					});
				}
			}

			// 4. SOURCE ATTRIBUTION
			if(structuredData.source || (structuredData.recommendations && structuredData.recommendations[0]?.source)) {
				const source = structuredData.source || structuredData.recommendations[0].source;

				formattedText += '\n';
				formattedText += `<i>📡 <b>Data Source:</b> ${ this._escapeHtml(source.api || 'Vybe Network') }</i>`;

				if(source.endpoint) {
					formattedText += ` <i>• ${ this._escapeHtml(source.endpoint) }</i>`;
				}

				if(source.timestamp) {
					const date = new Date(source.timestamp);
					formattedText += `\n<i>⏱️ <b>Timestamp:</b> ${ date.toLocaleString() }</i>`;
				}
			}

			return formattedText;
		} catch(error) {
			this.logger.warn('Error formatting structured data', { err: error });

			// Fallback to a very simple format that's guaranteed to work
			let fallbackText = '<b>📊 Data Summary:</b>\n\n';

			try {
				// Try to extract key data points that are likely to exist
				if(structuredData.recommendations) {
					fallbackText += `• <b>Found</b>: ${ structuredData.recommendations.length } token recommendations\n`;
				}
				if(structuredData.token) {
					fallbackText += `• <b>Token</b>: ${ structuredData.token.symbol || 'Unknown' }\n`;
				}
				if(structuredData.wallet) {
					fallbackText += `• <b>Wallet</b>: ${ structuredData.wallet.substring(0, 8) }...\n`;
				}

				return fallbackText;
			} catch(e) {
				// Ultra-safe fallback
				return '<b>📊 Data available but couldn\'t be formatted</b>';
			}
		}
	}

	/**
	 * Edit an existing message or send a new one with formatted response
	 */
	async _editOrSendNewMessage(ctx, response, messageId) {
		const formattedResponse = await this.formatEnhancedResponse(ctx, response);
		const inlineKeyboard = this.createDynamicKeyboard(response.structuredData);

		try {
			if(messageId) {
				// Try to edit the existing message
				await ctx.telegram.editMessageText(
					ctx.chat.id,
					messageId,
					null,
					formattedResponse,
					{
						parse_mode: 'HTML',
						...(inlineKeyboard && { reply_markup: inlineKeyboard }),
						disable_web_page_preview: true,
					},
				);
				this.logger.info('Successfully edited message with response', { messageId });
			} else {
				throw new Error('No message ID provided for editing');
			}
		} catch(editError) {
			this.logger.warn('Failed to edit message, sending as new', { err: editError });

			// Send as new message
			try {
				await ctx.reply(formattedResponse, {
					parse_mode: 'HTML',
					...(inlineKeyboard && { reply_markup: inlineKeyboard }),
					disable_web_page_preview: true,
				});
			} catch(replyError) {
				this.logger.error('Failed to send HTML response, trying plain text', { err: replyError });

				// Last resort: try plain text
				await ctx.reply(this._stripHtml(formattedResponse), {
					...(inlineKeyboard && { reply_markup: inlineKeyboard }),
				});
			}
		}
	}

	/**
	 * Send a fallback response when enhanced formatting fails
	 */
	async _sendFallbackResponse(ctx, response) {
		if(!response?.assistantMessage?.text) {
			await ctx.reply('I processed your request but had trouble generating a response. Please try again.');
			return;
		}

		// Create basic formatted response (just escaped HTML)
		const plainText = this._escapeHtml(response.assistantMessage.text);
		const simpleKeyboard = this.createSimpleKeyboard(response.structuredData);

		try {
			await ctx.reply(plainText, {
				parse_mode: 'HTML',
				...(simpleKeyboard && { reply_markup: simpleKeyboard }),
				disable_web_page_preview: true,
			});
		} catch(htmlError) {
			this.logger.error('Failed to send even basic HTML, using pure plain text', { err: htmlError });

			// Pure plain text as absolute fallback
			await ctx.reply(this._stripHtml(plainText), {
				...(simpleKeyboard && { reply_markup: simpleKeyboard }),
			});
		}
	}

	/**
	 * Format response with enhanced visuals (WOW factor)
	 * Robust implementation that gracefully handles any data format
	 */

	/**
	 * Función mejorada para formatear la respuesta con visuals
	 * Detecta y aplica mejoras específicas para tokens
	 */
	/**
	 * Formato de reserva ultra-simple para tokens en caso de error
	 * @param {object} token - Token data
	 * @returns {string} Simple formatted text
	 */
	_createSimpleTokenCard(token) {
		if(!token) return null;

		try {
			const symbol = this._escapeHtml(token.symbol || '???');
			const name = this._escapeHtml(token.name || symbol);
			const price = token.price_usd || token.price || 0;

			return `<b>${ name } (${ symbol })</b>\nPrice: $${ this._formatNumber(price) }`;
		} catch(e) {
			return `<b>Token ${ token.symbol || 'Info' }</b>`;
		}
	}

	/**
	 * Actualiza formatEnhancedResponse para usar la tarjeta épica
	 */
	async formatEnhancedResponse(ctx, response) {
		if(!response || !response.assistantMessage) {
			await ctx.reply('I processed your request but had trouble generating a response. Please try again.');
			return;
		}

		try {
			const MAX_MESSAGE_LENGTH = 4000;
			let message = '';
			let logoUrl = null;

			// Procesar información de token si está disponible
			if(response.structuredData && response.structuredData.token) {
				const tokenInfo = this._formatTokenInfo(response.structuredData.token);
				if(tokenInfo) {
					message += tokenInfo.card;
					logoUrl = tokenInfo.logoUrl;
				}
			}

			// Añadir el texto principal con formato mejorado
			const enhancedText = this._enhanceTextFormatting(response.assistantMessage.text);
			if(!message.includes(enhancedText.substring(0, 50))) {
				// Solo añadir el texto si no está ya incluido en la card
				message += enhancedText;
			}

			// Truncar si es necesario
			if(message.length > MAX_MESSAGE_LENGTH) {
				const truncationMsg = '\n\n<i>⚠️ Message truncated due to length limits...</i>';
				message = message.substring(0, MAX_MESSAGE_LENGTH - truncationMsg.length) + truncationMsg;
			}

			// Crear teclado con botones
			const inlineKeyboard = this.createDynamicKeyboard(response.structuredData);

			// IMPORTANTE: Para que aparezcan los botones y la imagen:
			// 1. Debemos mandar los botones como reply_markup
			// 2. Para que se vea el logo, NO deshabilitamos la vista previa web cuando hay logo
			const options = {
				parse_mode: 'HTML',
				disable_web_page_preview: !logoUrl,
			};

			// Opción 1: Si inlineKeyboard es el objeto completo con reply_markup
			if(inlineKeyboard && inlineKeyboard.reply_markup) {
				options.reply_markup = inlineKeyboard.reply_markup;
			}
			this.logger.info('[sendEnhancedResponse] Keyboard structure:', {
				keyboardType: typeof inlineKeyboard,
				hasReplyMarkup: inlineKeyboard && inlineKeyboard.reply_markup,
				isArray: Array.isArray(inlineKeyboard),
				keyboardStr: JSON.stringify(inlineKeyboard),
			});
			// Si hay logo, añadimos un enlace oculto al principio para que Telegram lo muestre como vista previa
			if(logoUrl) {
				// Añadir un enlace invisible al logo al principio del mensaje
				message = `<a href="${ logoUrl }">​</a>${ message }`;
			}

			// Enviar mensaje final
			await ctx.reply(message, options);

			this.logger.info('Enhanced response sent successfully', {
				hasLogo: !!logoUrl,
				hasButtons: !!inlineKeyboard,
				messageLength: message.length,
			});

		} catch(error) {
			this.logger.error('Error sending enhanced response', { err: error });

			// Fallback a formato simple en caso de error
			try {
				await ctx.reply(this._escapeHtml(response.assistantMessage.text));
			} catch(e) {
				await ctx.reply('Sorry, I encountered an error displaying the response.');
			}
		}
	}

	_createDataVisualization(structuredData) {
		try {
			let visualization = '';

			// For token recommendations
			if(structuredData.recommendations && Array.isArray(structuredData.recommendations)) {
				const tokens = structuredData.recommendations.slice(0, 5); // Limit to top 5

				// Create a clean bulleted list format (reliable in Telegram)
				visualization += `\n<b>🏆 TOP RECOMMENDATIONS</b>\n`;

				tokens.forEach((token, idx) => {
					const symbol = token.symbol || 'UNKNOWN';
					const price = this._formatNumber(token.price_usd || 0);
					const change = token.price_change_1d || token.price_change_24h || 0;
					const changeIndicator = change >= 0 ? '📈' : '📉';

					visualization += `\n${ idx + 1 }. <code>${ symbol }</code> - $${ price } ${ changeIndicator } ${ change >= 0 ? '+' : '' }${ change.toFixed(2) }%`;

					// Add reason if available
					if(token.reason) {
						const shortReason = token.reason.length > 50 ?
							token.reason.substring(0, 47) + '...' :
							token.reason;
						visualization += `\n   <i>${ shortReason }</i>`;
					}
				});
			}

			// For single token details
			else if(structuredData.token) {
				const token = structuredData.token;
				const symbol = token.symbol || 'UNKNOWN';
				const name = token.name || symbol;

				visualization += `\n<b>📊 ${ name } (${ symbol }) OVERVIEW</b>\n`;
				visualization += `\n• Price: $${ this._formatNumber(token.price_usd || token.price || 0) }`;

				if(token.price_change_1d !== undefined) {
					const change = token.price_change_1d;
					visualization += `\n• 24h Change: ${ change >= 0 ? '📈' : '📉' } ${ change >= 0 ? '+' : '' }${ change.toFixed(2) }%`;
				}

				if(token.marketCap) {
					visualization += `\n• Market Cap: $${ this._formatNumber(token.marketCap, true) }`;
				}

				if(token.volume_24h) {
					visualization += `\n• 24h Volume: $${ this._formatNumber(token.volume_24h, true) }`;
				}

				if(token.holders) {
					visualization += `\n• Holders: ${ this._formatNumber(token.holders) }`;
				}
			}

			// For wallet data
			else if(structuredData.wallet) {
				const wallet = structuredData.wallet;
				const tokens = structuredData.tokens?.data || [];

				visualization += `\n<b>💼 WALLET SUMMARY</b>\n`;

				if(structuredData.tokens?.totalTokenValueUsd) {
					visualization += `\n• Total Value: $${ this._formatNumber(structuredData.tokens.totalTokenValueUsd) }`;
				}

				if(tokens.length > 0) {
					visualization += `\n• Top Holdings:`;
					tokens.slice(0, 3).forEach((t, idx) => {
						visualization += `\n  ${ idx + 1 }. <code>${ t.symbol || 'UNKNOWN' }</code>: ${ this._formatNumber(t.balance || 0) } ($${ this._formatNumber(t.valueUsd || 0) })`;
					});
				}
			}

			return visualization;
		} catch(error) {
			this.logger.warn('Error creating data visualization', { err: error });
			return null;
		}
	}

	/**
	 * Creates a dynamic keyboard prioritizing specific data types if available.
	 * UPDATED to correctly detect all wallet data structures.
	 * @param {object} structuredData - The structured data from the response.
	 * @param {string[]} executedActions - Array of action names executed.
	 */
	createDynamicKeyboard(structuredData, executedActions = []) {
		// Helper function to safely build callback data and truncate if needed
		const buildCallbackData = (prefix, param1, param2 = null) => {
			const MAX_CALLBACK_DATA_LENGTH = 64;
			let base = `${ prefix }:${ param1 }`;
			if(param2 !== null) {
				base += `:${ param2 }`;
			}

			if(base.length > MAX_CALLBACK_DATA_LENGTH) {
				// Prioritize truncating the longest parameter (often param1 like address/symbol)
				const prefixLen = prefix.length + (param2 !== null ? 2 : 1); // +1 or +2 for colons
				const param2Len = param2 !== null ? String(param2).length : 0;
				const maxParam1Len = MAX_CALLBACK_DATA_LENGTH - prefixLen - param2Len;

				if(maxParam1Len < 3) { // Not enough space even after truncating
					this.logger.error('[createDynamicKeyboard] Cannot create valid callback, too long even after truncation.', { base });
					return null; // Indicate failure
				}
				const truncatedParam1 = String(param1).substring(0, maxParam1Len);
				base = `${ prefix }:${ truncatedParam1 }`;
				if(param2 !== null) {
					base += `:${ param2 }`;
				}
				this.logger.warn('[createDynamicKeyboard] Truncated callback data parameter.', {
					original: `${ prefix }:${ param1 }${ param2 !== null ? ':' + param2 : '' }`,
					truncated: base,
				});
			}
			return base;
		};

		if(!structuredData && (!executedActions || executedActions.length === 0)) {
			this.logger.info('[createDynamicKeyboard] No structuredData or executedActions provided.');
			return null;
		}

		// Normalize executedActions: handle array of strings OR array of objects
		const actionNames = (executedActions || []).map(action =>
			typeof action === 'string' ? action : action?.name,
		).filter(name => !!name); // Get only valid names
		const hasProgramRankingData = !!(
			// Specific program ranking structure
			(structuredData?.ranking &&
				structuredData.ranking.data &&
				Array.isArray(structuredData.ranking.data)) ||

			(structuredData?.data?.ranking &&
				structuredData.data.ranking.data &&
				Array.isArray(structuredData.data.ranking.data)) ||

			// Or related executed action
			actionNames.includes('fetch_program_ranking') ||
			actionNames.includes('get_top_programs')
		);
		const hasTokenRecommendationsData = !!(
			// Specific token recommendations structure
			(structuredData?.recommendations &&
				Array.isArray(structuredData.recommendations)) ||

			(structuredData?.data?.recommendations &&
				Array.isArray(structuredData.data.recommendations)) ||

			// Or related executed action
			actionNames.includes('recommend_tokens')
		);

		// Extract metadata for recommendations
		let recommendationsCriteria = null;
		let recommendationsRiskLevel = null;
		let recommendationsTimeframe = null;

		if(structuredData?.criteria) {
			recommendationsCriteria = structuredData.criteria;
		} else if(structuredData?.data?.criteria) {
			recommendationsCriteria = structuredData.data.criteria;
		}

		if(structuredData?.risk_level) {
			recommendationsRiskLevel = structuredData.risk_level;
		} else if(structuredData?.data?.risk_level) {
			recommendationsRiskLevel = structuredData.data.risk_level;
		}

		if(structuredData?.timeframe) {
			recommendationsTimeframe = structuredData.timeframe;
		} else if(structuredData?.data?.timeframe) {
			recommendationsTimeframe = structuredData.data.timeframe;
		}

		// Extract ranking data for buttons
		let rankingInterval = null;
		let rankingPage = null;

		if(structuredData?.ranking?.interval) {
			rankingInterval = structuredData.ranking.interval;
		} else if(structuredData?.data?.ranking?.interval) {
			rankingInterval = structuredData.data.ranking.interval;
		}

		if(structuredData?.page) {
			rankingPage = structuredData.page;
		} else if(structuredData?.data?.page) {
			rankingPage = structuredData.data.page;
		}

		const hasPricePredictionData = !!(
			// Specific price prediction structure
			(structuredData?.tokenSymbol &&
				structuredData?.prediction) ||

			(structuredData?.data?.tokenSymbol &&
				structuredData?.data?.prediction) ||

			// Or related executed action
			actionNames.includes('get_price_prediction')
		);

		// Extract token details for buttons
		let predictionTokenSymbol = null;
		let predictionTokenAddress = null;

		if(structuredData?.tokenSymbol) {
			predictionTokenSymbol = structuredData.tokenSymbol;
			predictionTokenAddress = structuredData.token;
		} else if(structuredData?.data?.tokenSymbol) {
			predictionTokenSymbol = structuredData.data.tokenSymbol;
			predictionTokenAddress = structuredData.data.token;
		}

		// Extract timeframe if available
		let predictionTimeframe = null;
		if(structuredData?.timeframe) {
			predictionTimeframe = structuredData.timeframe;
		} else if(structuredData?.data?.timeframe) {
			predictionTimeframe = structuredData.data.timeframe;
		}

		// --- Enhanced Data Detection Logic ---
		const hasProgramActiveUsersData = !!(
			// Specific program active users structure
			(structuredData?.programId && structuredData?.activeUsers) ||
			(structuredData?.data?.programId && structuredData?.data?.activeUsers) ||
			// Or related executed action
			actionNames.includes('fetch_program_active_users') ||
			actionNames.includes('get_program_users')
		);

		// Extract program ID for active users
		let activeUsersProgramId = null;
		if(structuredData?.programId) {
			activeUsersProgramId = structuredData.programId;
		} else if(structuredData?.data?.programId) {
			activeUsersProgramId = structuredData.data.programId;
		}

		// Check for wallet data - ENHANCED to detect multiple possible structures
		const hasWalletData = !!(
			// Propiedades directas de wallet
			structuredData?.wallet ||
			// Wallet en estructura de datos
			structuredData?.data?.wallet ||
			// Wallet en estructura de tokens
			structuredData?.data?.tokens?.ownerAddress ||
			// Wallet en datos de TimeSeries
			(structuredData?.data?.timeSeriesData &&
				(structuredData?.data?.timeSeriesData.ownerAddress ||
					(Array.isArray(structuredData?.data?.timeSeriesData.data) &&
						structuredData?.data?.timeSeriesData.data[0]?.ownerAddress))) ||
			// Acciones ejecutadas para wallet
			actionNames.includes('fetch_wallet_data') ||
			actionNames.includes('fetch_wallet_tokens') ||
			actionNames.includes('fetch_wallet_nfts') ||
			actionNames.includes('fetch_wallet_pnl') ||
			actionNames.includes('get_wallet_tokens_time_series')
		);
		// Detector para datos de top tokens
		const hasTopTokensData = !!(
			// Estructura específica de top tokens
			(structuredData?.data?.tokens?.data &&
				Array.isArray(structuredData.data.tokens.data) &&
				structuredData.data.tokens.data.length > 0) ||
			// O acción ejecutada relacionada
			actionNames.includes('fetch_top_tokens') ||
			actionNames.includes('recommend_tokens')
		);

		const hasProgramDetailsData = !!(
			// Specific program details structure
			(structuredData?.programId && structuredData?.details) ||
			(structuredData?.data?.programId && structuredData?.data?.details) ||
			// Or related executed action
			actionNames.includes('fetch_program_details') ||
			actionNames.includes('analyze_program')
		);

		// Extract program ID from various possible locations
		let programId = null;
		if(structuredData?.programId) {
			programId = structuredData.programId;
		} else if(structuredData?.data?.programId) {
			programId = structuredData.data.programId;
		} else if(structuredData?.details?.programId) {
			programId = structuredData.details.programId;
		} else if(structuredData?.data?.details?.programId) {
			programId = structuredData.data.details.programId;
		}

		// Extract wallet address from any available location
		let walletAddress = null;
		if(structuredData?.wallet) {
			walletAddress = structuredData.wallet;
		} else if(structuredData?.data?.wallet) {
			walletAddress = structuredData.data.wallet;
		} else if(structuredData?.data?.tokens?.ownerAddress) {
			walletAddress = structuredData.data.tokens.ownerAddress;
		} else if(structuredData?.data?.timeSeriesData) {
			if(structuredData.data.timeSeriesData.ownerAddress) {
				walletAddress = structuredData.data.timeSeriesData.ownerAddress;
			} else if(Array.isArray(structuredData.data.timeSeriesData.data) &&
				structuredData.data.timeSeriesData.data.length > 0) {
				walletAddress = structuredData.data.timeSeriesData.data[0].ownerAddress;
			}
		}

		// Other data type detection (existing logic)
		const hasValidHistoryData = !!(
			(structuredData?.data?.priceData?.data && Array.isArray(structuredData.data.priceData.data) && structuredData.data.priceData.data.length > 0) ||
			(structuredData?.priceData?.data && Array.isArray(structuredData.priceData.data) && structuredData.priceData.data.length > 0)
		);
		const hasValidTokenObject = !!(structuredData?.token && typeof structuredData.token === 'object');
		const hasRecommendations = !!(structuredData?.recommendations && Array.isArray(structuredData.recommendations) && structuredData.recommendations.length > 0);

		// Token holders data detection
		const hasHoldersData = !!(
			(structuredData?.data?.holdersData?.data &&
				Array.isArray(structuredData.data.holdersData.data) &&
				structuredData.data.holdersData.data.length > 0)
		);

		this.logger.info('[createDynamicKeyboard] Creating keyboard based on detected data:', {
			hasStructuredData: !!structuredData,
			executedActionNames: actionNames,
			hasValidTokenObject: hasValidTokenObject,
			hasValidHistoryData: hasValidHistoryData,
			hasRecommendations: hasRecommendations,
			hasWalletData: hasWalletData,
			walletAddress: walletAddress,
			hasHoldersData: hasHoldersData,
		});

		try {
			let buttons = [];
			const historyActionExecuted = actionNames.includes('fetch_token_price_history');
			const holdersActionExecuted = actionNames.includes('fetch_token_holders');
			const walletActionExecuted = actionNames.includes('fetch_wallet_data') ||
				actionNames.includes('fetch_wallet_tokens') ||
				actionNames.includes('fetch_wallet_nfts');

			// --- PRIORIDAD 1: Botones de Historial de Precios ---
			if(historyActionExecuted || hasValidHistoryData) {
				// [Existing history button logic]
				this.logger.info('[createDynamicKeyboard] Prioritizing History buttons.');
				// Obtener datos de la estructura correcta
				const historyDataSource = structuredData?.priceData ? structuredData : structuredData?.data;

				if(historyDataSource) { // Asegurarse de que tenemos la fuente de datos
					const tokenAddress = historyDataSource.token; // Puede ser string address o un objeto token
					const currentResolution = historyDataSource.resolution || '1d';

					// Intentar obtener un símbolo o nombre para mostrar
					let displaySymbol = 'Token';
					if(typeof tokenAddress === 'string') {
						displaySymbol = `${ tokenAddress.substring(0, 4) }..`; // Fallback si solo es dirección
					}
					// Si structuredData.token es un objeto, intentar usarlo (más robusto)
					if(structuredData?.token && typeof structuredData.token === 'object') {
						displaySymbol = structuredData.token.symbol || structuredData.token.name || displaySymbol;
					}
					// O si la dirección está en historyDataSource Y tenemos el objeto token aparte
					else if(typeof tokenAddress === 'string' && hasValidTokenObject) {
						displaySymbol = structuredData.token.symbol || structuredData.token.name || displaySymbol;
					}

					const actualAddress = typeof tokenAddress === 'string' ? tokenAddress : (structuredData?.token?.address || structuredData?.token?.mintAddress);

					const historyButtons = [];
					const resolutionButtons = [];
					if(actualAddress) {
						const resolutions = [ '1h', '4h', '1d', '1w' ];
						resolutions.forEach(res => {
							const cbData = buildCallbackData('token:history', actualAddress, res);
							if(cbData) { // Solo añadir si el callback se pudo construir
								resolutionButtons.push(Markup.button.callback(currentResolution === res ? `✅ ${ res }` : res, cbData));
							}
						});
					}
					if(resolutionButtons.length > 0) historyButtons.push(resolutionButtons);

					const otherHistoryButtons = [];
					if(actualAddress || displaySymbol !== 'Token') {
						const cbData = buildCallbackData('token:price', actualAddress || displaySymbol);
						if(cbData) otherHistoryButtons.push(Markup.button.callback(`📈 Current ${ displaySymbol }`, cbData));
					}
					if(actualAddress) {
						otherHistoryButtons.push(Markup.button.url('Full Chart ↗️', `https://dexscreener.com/solana/${ actualAddress }`));
					}
					if(otherHistoryButtons.length > 0) historyButtons.push(otherHistoryButtons);

					if(historyButtons.length > 0) buttons = historyButtons;
					this.logger.info('[createDynamicKeyboard] History buttons generated.', { count: buttons.flat().length });
				} else {
					this.logger.warn('[createDynamicKeyboard] History action/data detected, but source object is missing.');
				}
			}

			// --- PRIORITY: Token Holders Data ---
			else if(holdersActionExecuted || hasHoldersData) {
				// [Token holders button logic]
				this.logger.info('[createDynamicKeyboard] Prioritizing Holders buttons.');

				// Extract token data from holders structure
				const holdersDataSource = structuredData?.data?.holdersData || structuredData?.holdersData;
				let tokenSymbol = null;
				let tokenAddress = null;

				// Try to find token details in multiple possible locations
				if(holdersDataSource?.data && holdersDataSource.data.length > 0) {
					// Commonly the first holder has token info
					tokenSymbol = holdersDataSource.data[0]?.tokenSymbol;
					tokenAddress = holdersDataSource.data[0]?.tokenMint;
				}

				// Fallback to structuredData.data.token
				if(!tokenAddress && structuredData?.data?.token) {
					tokenAddress = structuredData.data.token;
				}

				// If we have token object, use that info
				if(!tokenSymbol && hasValidTokenObject) {
					tokenSymbol = structuredData.token.symbol;
					tokenAddress = structuredData.token.mintAddress || structuredData.token.address;
				}

				const holdersButtons = [];

				// First row: Main token actions
				const row1 = [];
				if(tokenSymbol) {
					const cbPrice = buildCallbackData('token:price', tokenSymbol);
					if(cbPrice) row1.push(Markup.button.callback(`💰 ${ tokenSymbol } Price`, cbPrice));

					const cbHistory = buildCallbackData('token:history', tokenAddress || tokenSymbol);
					if(cbHistory) row1.push(Markup.button.callback('📊 Price History', cbHistory));
				}
				if(row1.length > 0) holdersButtons.push(row1);

				// Second row: Explorer and other actions
				const row2 = [];
				if(tokenAddress) {
					// Add SolScan explorer button
					row2.push(Markup.button.url('🔍 Explorer', `https://solscan.io/token/${ tokenAddress }`));

					// Add holders update button that maintains context
					const cbUpdateHolders = buildCallbackData('token:holders', tokenSymbol || tokenAddress);
					if(cbUpdateHolders) row2.push(Markup.button.callback('🔄 Update Holders', cbUpdateHolders));
				}
				if(row2.length > 0) holdersButtons.push(row2);

				if(holdersButtons.length > 0) buttons = holdersButtons;
				this.logger.info('[createDynamicKeyboard] Holders buttons generated.', { count: buttons.flat().length });
			}

			// --- PRIORIDAD 2: Botones de Info de Token ---
			else if(hasValidTokenObject) {
				// [Existing token info button logic]
				this.logger.info('[createDynamicKeyboard] Prioritizing Token Info buttons.');
				const token = structuredData.token; // Sabemos que es un objeto
				const symbol = token.symbol || 'TOKEN'; // Usar 'TOKEN' como fallback si no hay símbolo
				const address = token.mintAddress || token.address;
				const tokenButtons = [];

				const row1 = [];
				const cbHistory = buildCallbackData('token:history', address || symbol); // Usa address o symbol
				if(cbHistory) row1.push(Markup.button.callback('📊 History/Chart', cbHistory));

				if(symbol !== 'TOKEN') { // Solo añadir holders/alert si tenemos símbolo real
					const cbHolders = buildCallbackData('token:holders', symbol);
					if(cbHolders) row1.push(Markup.button.callback('👥 Holders', cbHolders));
				}
				if(row1.length > 0) tokenButtons.push(row1);

				const row2 = [];
				if(symbol !== 'TOKEN') {
					const cbAlert = buildCallbackData('alert:set', symbol);
					if(cbAlert) row2.push(Markup.button.callback('🔔 Alert', cbAlert));
				}
				if(address) {
					const explorerUrl = `https://solscan.io/token/${ address }`;
					row2.push(Markup.button.url('🔍 Explorer', explorerUrl));
				}
				if(row2.length > 0) tokenButtons.push(row2);

				if(tokenButtons.length > 0) buttons = tokenButtons;
				this.logger.info('[createDynamicKeyboard] Token Info buttons generated.', { count: buttons.flat().length });
			}

				// --- PRIORIDAD 3: Botones de Wallet Data ---
			// ENHANCED LOGIC FOR WALLET DATA
			else if(walletActionExecuted || hasWalletData) {
				this.logger.info('[createDynamicKeyboard] Prioritizing Wallet buttons.');

				// Try to extract wallet address from all possible locations
				if(!walletAddress) {
					this.logger.warn('[createDynamicKeyboard] Wallet data detected but address not found, using default buttons.');
					buttons.push([
						Markup.button.callback('🔍 Top Tokens', 'action:explore_top_tokens'),
						Markup.button.callback('❓ Help', 'action:show_help'),
					]);
				} else {
					const walletButtons = [];

					// First row: Main wallet analysis actions
					const cbTokens = buildCallbackData('wallet:tokens', walletAddress);
					const cbPnl = buildCallbackData('wallet:pnl', walletAddress);
					const cbNfts = buildCallbackData('wallet:nfts', walletAddress);
					const isWalletTimeSeries = !!(
						structuredData?.data?.timeSeriesData ||
						(structuredData?.data?.wallet && structuredData?.data?.days) ||
						actionNames.includes('get_wallet_tokens_time_series')
					);

					const row1 = [];
					if(cbTokens) row1.push(Markup.button.callback('💰 Holdings', cbTokens));
					if(cbPnl) row1.push(Markup.button.callback('📊 PnL', cbPnl));
					if(row1.length > 0) walletButtons.push(row1);

					// Second row: Advanced wallet actions
					const row2 = [];
					if(cbNfts) row2.push(Markup.button.callback('🖼️ NFTs', cbNfts));

					const cbActivity = buildCallbackData('wallet:activity', walletAddress);
					if(cbActivity) row2.push(Markup.button.callback('📝 Activity', cbActivity));

					if(row2.length > 0) walletButtons.push(row2);

					if(isWalletTimeSeries) {
						const row3 = [];
						// Botón para ver historial de diferentes periodos
						const periodos = [ '7d', '30d', '90d' ];
						// Determinar el período actual
						const currentPeriod = structuredData?.data?.days ?
							(structuredData.data.days === 7 ? '7d' :
								structuredData.data.days === 30 ? '30d' :
									structuredData.data.days === 90 ? '90d' : '30d') : '30d';

						// Crear botones para cada período
						periodos.forEach(periodo => {
							const cbData = buildCallbackData('wallet:history', walletAddress, periodo);
							if(cbData) {
								row3.push(Markup.button.callback(
									currentPeriod === periodo ? `✅ ${ periodo }` : periodo,
									cbData,
								));
							}
						});

						if(row3.length > 0) walletButtons.push(row3);
					}

					// Third row: External links
					const explorerUrl = `https://solscan.io/account/${ walletAddress }`;
					const jupiterUrl = `https://jup.ag/swap/SOL-BONK`;

					walletButtons.push([
						Markup.button.url('🌐 Explorer', explorerUrl),
						Markup.button.url('🔄 Trade', jupiterUrl),
					]);

					if(walletButtons.length > 0) buttons = walletButtons;
					this.logger.info('[createDynamicKeyboard] Wallet buttons generated.', { count: buttons.flat().length });
				}
			} else if(hasTopTokensData) {
				this.logger.info('[createDynamicKeyboard] Prioritizing Top Tokens buttons.');

				// Extraer datos de tokens
				const tokensData = structuredData?.data?.tokens?.data || [];
				const topTokens = tokensData.slice(0, 4); // Tomar los primeros 4 tokens

				const topTokensButtons = [];

				// Primera fila: Botones para los tokens principales
				if(topTokens.length > 0) {
					const row1 = topTokens.slice(0, 2).map(token => {
						const symbol = token.symbol || 'UNKNOWN';
						const cbData = buildCallbackData('token:info', symbol);
						return cbData ? Markup.button.callback(`${ symbol }`, cbData) : null;
					}).filter(btn => btn !== null);

					if(row1.length > 0) topTokensButtons.push(row1);

					// Segunda fila si hay más de 2 tokens
					if(topTokens.length > 2) {
						const row2 = topTokens.slice(2, 4).map(token => {
							const symbol = token.symbol || 'UNKNOWN';
							const cbData = buildCallbackData('token:info', symbol);
							return cbData ? Markup.button.callback(`${ symbol }`, cbData) : null;
						}).filter(btn => btn !== null);

						if(row2.length > 0) topTokensButtons.push(row2);
					}
				}

				// Fila adicional: acciones de categoría
				const categoriesRow = [];
				const cbMeme = buildCallbackData('action:category', 'meme');
				const cbDefi = buildCallbackData('action:category', 'defi');
				const cbNew = buildCallbackData('action:category', 'new');

				if(cbMeme) categoriesRow.push(Markup.button.callback('🐶 Meme', cbMeme));
				if(cbDefi) categoriesRow.push(Markup.button.callback('💰 DeFi', cbDefi));
				if(cbNew) categoriesRow.push(Markup.button.callback('🆕 New', cbNew));

				if(categoriesRow.length > 0) topTokensButtons.push(categoriesRow);

				// Fila final: botones de clasificación/actualización
				topTokensButtons.push([
					Markup.button.callback('📊 By Volume', 'action:sort_volume'),
					Markup.button.callback('🔄 Refresh', 'action:explore_top_tokens'),
				]);

				if(topTokensButtons.length > 0) buttons = topTokensButtons;
				this.logger.info('[createDynamicKeyboard] Top Tokens buttons generated.', { count: buttons.flat().length });
			} else if(hasTokenRecommendationsData) {
				this.logger.info('[createDynamicKeyboard] Prioritizing Token Recommendations buttons.');

				// Get recommendations array
				let recommendations = [];
				if(structuredData?.recommendations && Array.isArray(structuredData.recommendations)) {
					recommendations = structuredData.recommendations;
				} else if(structuredData?.data?.recommendations && Array.isArray(structuredData.data.recommendations)) {
					recommendations = structuredData.data.recommendations;
				}

				const recommendationButtons = [];

				// Row 1: Individual token buttons (first 2-4 tokens)
				if(recommendations.length > 0) {
					const tokensPerRow = recommendations.length >= 4 ? 2 : recommendations.length;

					for(let i = 0; i < Math.min(4, recommendations.length); i += tokensPerRow) {
						const row = [];

						for(let j = 0; j < tokensPerRow && i + j < Math.min(4, recommendations.length); j++) {
							const token = recommendations[i + j];
							const symbol = token.symbol || 'TOKEN';
							const cbData = buildCallbackData('token:info', symbol);
							if(cbData) row.push(Markup.button.callback(symbol, cbData));
						}

						if(row.length > 0) recommendationButtons.push(row);
					}
				}

				// Row 2-3: Category filters
				const categoriesRow = [];
				const cbMeme = buildCallbackData('action:category', 'meme');
				const cbDefi = buildCallbackData('action:category', 'defi');
				const cbNew = buildCallbackData('action:category', 'new');

				if(cbMeme) categoriesRow.push(Markup.button.callback('🐶 Meme', cbMeme));
				if(cbDefi) categoriesRow.push(Markup.button.callback('💰 DeFi', cbDefi));
				if(cbNew) categoriesRow.push(Markup.button.callback('🆕 New', cbNew));

				if(categoriesRow.length > 0) recommendationButtons.push(categoriesRow);

				// Row 4: Risk level filters
				const riskLevel = recommendationsRiskLevel || 'medium';
				const riskLevelsRow = [];

				const cbLow = buildCallbackData('risk:level', 'low');
				const cbMedium = buildCallbackData('risk:level', 'medium');
				const cbHigh = buildCallbackData('risk:level', 'high');

				if(cbLow) riskLevelsRow.push(Markup.button.callback(
					riskLevel === 'low' ? '✅ Low Risk' : 'Low Risk',
					cbLow,
				));

				if(cbMedium) riskLevelsRow.push(Markup.button.callback(
					riskLevel === 'medium' ? '✅ Medium Risk' : 'Medium Risk',
					cbMedium,
				));

				if(cbHigh) riskLevelsRow.push(Markup.button.callback(
					riskLevel === 'high' ? '✅ High Risk' : 'High Risk',
					cbHigh,
				));

				if(riskLevelsRow.length > 0) recommendationButtons.push(riskLevelsRow);

				// Row 5: Sort/filter options
				const actionsRow = [];

				const cbSortVolume = buildCallbackData('action:sort_volume', '');
				if(cbSortVolume) actionsRow.push(Markup.button.callback('📊 By Volume', cbSortVolume));

				const cbRefresh = buildCallbackData('action:explore_top_tokens', '');
				if(cbRefresh) actionsRow.push(Markup.button.callback('🔄 Refresh', cbRefresh));

				if(actionsRow.length > 0) recommendationButtons.push(actionsRow);

				if(recommendationButtons.length > 0) buttons = recommendationButtons;
				this.logger.info('[createDynamicKeyboard] Token Recommendations buttons generated.', { count: buttons.flat().length });
			} else if(hasPricePredictionData && predictionTokenSymbol) {
				this.logger.info('[createDynamicKeyboard] Prioritizing Price Prediction buttons.');

				const predictionButtons = [];

				// Row 1: Token info and history buttons
				const row1 = [];

				// Token info button
				const cbInfo = buildCallbackData('token:info', predictionTokenSymbol);
				if(cbInfo) row1.push(Markup.button.callback(`🪙 ${ predictionTokenSymbol } Info`, cbInfo));

				// History button
				const cbHistory = buildCallbackData('token:history', predictionTokenAddress || predictionTokenSymbol);
				if(cbHistory) row1.push(Markup.button.callback('📊 Price History', cbHistory));

				if(row1.length > 0) predictionButtons.push(row1);

				// Row 2: Timeframe buttons
				const timeframes = [ '24h', '7d', '30d' ];
				const currentTimeframe = predictionTimeframe || '24h';

				const row2 = [];
				timeframes.forEach(time => {
					const cbTimeframe = buildCallbackData('predict:timeframe', predictionTokenSymbol, time);
					if(cbTimeframe) {
						row2.push(Markup.button.callback(
							currentTimeframe === time ? `✅ ${ time }` : time,
							cbTimeframe,
						));
					}
				});

				if(row2.length > 0) predictionButtons.push(row2);

				// Row 3: Buy and explore buttons
				const row3 = [];

				// Add holders button
				const cbHolders = buildCallbackData('token:holders', predictionTokenSymbol);
				if(cbHolders) row3.push(Markup.button.callback('👥 Holders', cbHolders));

				// Add alert button
				const cbAlert = buildCallbackData('alert:set', predictionTokenSymbol);
				if(cbAlert) row3.push(Markup.button.callback('🔔 Set Alert', cbAlert));

				if(row3.length > 0) predictionButtons.push(row3);

				// Row 4: Explorer links
				const row4 = [];

				// Explorer link
				if(predictionTokenAddress) {
					row4.push(Markup.button.url('🔍 Explorer', `https://solscan.io/token/${ predictionTokenAddress }`));
				}

				// Add Jupiter link for trading
				row4.push(Markup.button.url('💱 Trade', `https://jup.ag/swap/SOL-${ predictionTokenSymbol }`));

				if(row4.length > 0) predictionButtons.push(row4);

				if(predictionButtons.length > 0) buttons = predictionButtons;
				this.logger.info('[createDynamicKeyboard] Price Prediction buttons generated.', { count: buttons.flat().length });
			} else if(hasProgramActiveUsersData && activeUsersProgramId) {
				this.logger.info('[createDynamicKeyboard] Prioritizing Program Active Users buttons.');

				// Extract time period
				const days = structuredData?.days || structuredData?.data?.days || 7;

				const programButtons = [];

				// Row 1: Time period filters
				const row1 = [];

				const periods = [ 7, 30, 90 ];
				periods.forEach(period => {
					const cbPeriod = buildCallbackData('program:users', activeUsersProgramId, period.toString());
					if(cbPeriod) {
						row1.push(Markup.button.callback(
							days === period ? `✅ ${ period }d` : `${ period }d`,
							cbPeriod,
						));
					}
				});

				if(row1.length > 0) programButtons.push(row1);

				// Row 2: Program info and other analysis options
				const row2 = [];

				// Button to view program details
				const cbDetails = buildCallbackData('program:info', activeUsersProgramId);
				if(cbDetails) row2.push(Markup.button.callback('📱 Program Info', cbDetails));

				// Button to view transactions
				const cbTxns = buildCallbackData('program:transactions', activeUsersProgramId);
				if(cbTxns) row2.push(Markup.button.callback('📊 Transactions', cbTxns));

				if(row2.length > 0) programButtons.push(row2);

				// Row 3: External links
				const explorerUrl = `https://solscan.io/account/${ activeUsersProgramId }`;
				programButtons.push([
					Markup.button.url('🔍 Explorer', explorerUrl),
					Markup.button.url('🌐 Jupiter', 'https://jup.ag'),  // For Jupiter specifically since this is Jupiter data
				]);

				if(programButtons.length > 0) buttons = programButtons;
				this.logger.info('[createDynamicKeyboard] Program Active Users buttons generated.', { count: buttons.flat().length });
			} else if(hasProgramRankingData) {
				this.logger.info('[createDynamicKeyboard] Prioritizing Program Ranking buttons.');

				// Extract time interval if available
				const interval = rankingInterval || '1d';
				const page = rankingPage || 1;

				const rankingButtons = [];

				// Row 1: Time period filters
				const row1 = [];

				const intervals = [ '1d', '7d', '30d' ];
				intervals.forEach(period => {
					const cbPeriod = buildCallbackData('programs:ranking', period, '1'); // Set page to 1 on interval change
					if(cbPeriod) {
						row1.push(Markup.button.callback(
							interval === period ? `✅ ${ period }` : period,
							cbPeriod,
						));
					}
				});

				if(row1.length > 0) rankingButtons.push(row1);

				// Row 2: Pagination if needed
				if(page) {
					const row2 = [];

					// Previous page button if not on first page
					if(page > 1) {
						const cbPrev = buildCallbackData('programs:ranking', interval, (page - 1).toString());
						if(cbPrev) row2.push(Markup.button.callback('⬅️ Previous', cbPrev));
					}

					// Next page button
					const cbNext = buildCallbackData('programs:ranking', interval, (page + 1).toString());
					if(cbNext) row2.push(Markup.button.callback('➡️ Next', cbNext));

					if(row2.length > 0) rankingButtons.push(row2);
				}

				// Row 3: Category filters
				const row3 = [];

				const cbDefi = buildCallbackData('programs:category', 'defi');
				if(cbDefi) row3.push(Markup.button.callback('💰 DeFi', cbDefi));

				const cbNft = buildCallbackData('programs:category', 'nft');
				if(cbNft) row3.push(Markup.button.callback('🖼️ NFT', cbNft));

				const cbGaming = buildCallbackData('programs:category', 'gaming');
				if(cbGaming) row3.push(Markup.button.callback('🎮 Gaming', cbGaming));

				if(row3.length > 0) rankingButtons.push(row3);

				// Row 4: Refresh button
				rankingButtons.push([
					Markup.button.callback('🔄 Refresh', 'programs:ranking:1d:1'),
				]);

				if(rankingButtons.length > 0) buttons = rankingButtons;
				this.logger.info('[createDynamicKeyboard] Program Ranking buttons generated.', { count: buttons.flat().length });
			}
			// --- PRIORIDAD 4: Botones de Recomendaciones ---
			else if(hasRecommendations) {
				// [Existing recommendations button logic]
				this.logger.info('[createDynamicKeyboard] Prioritizing Recommendations buttons.');
				const tokens = structuredData.recommendations.slice(0, 3);
				const recommendationButtons = [];
				if(tokens.length > 0) {
					const viewButtons = tokens.map(token => {
						const symbol = token.symbol || '???';
						const cbData = buildCallbackData('token:info', symbol);
						return cbData ? Markup.button.callback(`📊 ${ symbol }`, cbData) : null;
					}).filter(btn => btn !== null); // Filtrar nulos si callback falló

					if(viewButtons.length > 0) recommendationButtons.push(viewButtons);
					recommendationButtons.push([ Markup.button.callback('🔄 More Tokens', 'action:more_recommendations') ]);
				}
				if(recommendationButtons.length > 0) buttons = recommendationButtons;
				this.logger.info('[createDynamicKeyboard] Recommendations buttons generated.', { count: buttons.flat().length });
			} else if(hasProgramDetailsData && programId) {
				this.logger.info('[createDynamicKeyboard] Prioritizing Program Details buttons.');

				// Extract program details
				const details = structuredData?.details || structuredData?.data?.details || {};
				const programName = details.friendlyName || details.name || 'Program';

				const programButtons = [];

				// Row 1: Main program actions
				const row1 = [];

				// Button to view transactions
				const cbTxns = buildCallbackData('program:transactions', programId);
				if(cbTxns) row1.push(Markup.button.callback('📊 Transactions', cbTxns));

				// Button to view statistics
				const cbStats = buildCallbackData('program:stats', programId);
				if(cbStats) row1.push(Markup.button.callback('📈 Stats', cbStats));

				if(row1.length > 0) programButtons.push(row1);

				// Row 2: Related actions
				const row2 = [];

				// If it has a token, add token info button
				if(details.token) {
					const cbToken = buildCallbackData('token:info', details.token);
					if(cbToken) row2.push(Markup.button.callback('🪙 Token', cbToken));
				}

				// Add similar programs button
				const cbSimilar = buildCallbackData('program:similar', details.labels ? details.labels[0] : 'DEFI');
				if(cbSimilar) row2.push(Markup.button.callback('🔄 Similar Apps', cbSimilar));

				if(row2.length > 0) programButtons.push(row2);

				// Row 3: External links
				const row3 = [];

				// Explorer link
				const explorerUrl = `https://solscan.io/account/${ programId }`;
				row3.push(Markup.button.url('🔍 Explorer', explorerUrl));

				// Website link if available
				if(details.website) {
					row3.push(Markup.button.url('🌐 Website', details.website));
				}
				// For Jupiter specifically, add direct link
				else if(programName.toLowerCase().includes('jupiter')) {
					row3.push(Markup.button.url('🌐 Website', 'https://jup.ag'));
				}

				if(row3.length > 0) programButtons.push(row3);

				if(programButtons.length > 0) buttons = programButtons;
				this.logger.info('[createDynamicKeyboard] Program Details buttons generated.', { count: buttons.flat().length });
			}
			// --- Botones por Defecto ---
			if(buttons.length === 0) {
				this.logger.info('[createDynamicKeyboard] No specific data/action context found, adding default buttons.');
				buttons.push([
					Markup.button.callback('🔍 Top Tokens', 'action:explore_top_tokens'),
					Markup.button.callback('❓ Help', 'action:show_help'),
				]);
				this.logger.info('[createDynamicKeyboard] Default buttons generated.', { count: buttons.flat().length });
			}

			return buttons.length > 0 ? { reply_markup: { inline_keyboard: buttons } } : null;

		} catch(error) {
			this.logger.error('Error creating dynamic keyboard', { err: error });
			return Markup.inlineKeyboard([
				[ Markup.button.callback('❓ Help', 'action:show_help') ],
			]);
		}
	}

	/**
	 * Create a simpler fallback keyboard
	 */
	createSimpleKeyboard(structuredData) {
		if(!structuredData) return null;

		try {
			// Just create a single row with 1-2 basic actions
			const buttons = [];

			if(structuredData.token || structuredData.recommendations) {
				buttons.push(Markup.button.callback('📊 Market Analysis', 'action:market_overview'));
			}

			if(structuredData.wallet) {
				buttons.push(Markup.button.callback('📈 Top Tokens', 'action:explore_top_tokens'));
			}

			// Generic help button as fallback
			if(buttons.length === 0) {
				buttons.push(Markup.button.callback('❓ Help', 'action:show_help'));
			}

			return buttons.length > 0 ? Markup.inlineKeyboard([ buttons ]) : null;
		} catch(error) {
			this.logger.warn('Error creating simple keyboard', { err: error });
			return null;
		}
	}

	/**
	 * Enhance text formatting in a Telegram-compatible way
	 * @param {string} text - Original text
	 * @returns {string} - Enhanced text with HTML formatting
	 */
	_enhanceTextFormatting(text) {
		if(!text || typeof text !== 'string') return '';

		let enhancedText = this._escapeHtml(text);

		try {
			// Highlight token symbols - This is safe in Telegram
			enhancedText = enhancedText.replace(/\b([A-Z]{2,5})\b(?!<\/)/g, '<code>$1</code>');

			// Highlight dollar amounts - safely
			enhancedText = enhancedText.replace(/\$(\d+(?:,\d+)*(?:\.\d+)?[KMBTkmbt]?)/g, '💰 <b>$1</b>');

			// Highlight percentages - BUT WITHOUT USING COLOR SPANS
			enhancedText = enhancedText.replace(/(\+|\-)?(\d+(?:\.\d+)?)%/g, (match, sign, num) => {
				const value = parseFloat(num);
				const isPositive = sign !== '-';
				const emoji = isPositive ? '📈' : '📉';
				return `${ emoji } <b>${ match }</b>`;  // Just bold, no color spans
			});

			// Highlight wallet addresses
			enhancedText = enhancedText.replace(/\b([A-HJ-NP-Za-km-z1-9]{32,44})\b/g, '<code>$1</code>');

			return enhancedText;
		} catch(error) {
			this.logger.warn('Error enhancing text formatting', { err: error });
			return this._escapeHtml(text); // Return original escaped text as fallback
		}
	}

	/**
	 * Create token dashboard visual
	 */
	_createTokenDashboard(token) {
		try {
			const symbol = token.symbol || '???';
			const name = token.name || symbol;
			const price = token.price_usd || token.price || 0;
			const change1d = token.price_change_1d || 0;
			const change7d = token.price_change_7d || 0;
			const volume = token.volume_24h || 0;
			const marketCap = token.marketCap || 0;

			// Choose emojis based on performance
			const trend1dEmoji = change1d > 5 ? '🚀' : (change1d > 0 ? '📈' : (change1d < -5 ? '💥' : '📉'));
			const trend7dEmoji = change7d > 10 ? '🚀' : (change7d > 0 ? '📈' : (change7d < -10 ? '💥' : '📉'));

			// Format price changes with colors
			const change1dColor = change1d >= 0 ? 'green' : 'red';
			const change7dColor = change7d >= 0 ? 'green' : 'red';
			const change1dStr = `${ change1d >= 0 ? '+' : '' }${ change1d.toFixed(2) }%`;
			const change7dStr = `${ change7d >= 0 ? '+' : '' }${ change7d.toFixed(2) }%`;

			// Create visual dashboard
			let visual = `
<pre>┏━━━━━━━━━━ 💎 TOKEN DASHBOARD 💎 ━━━━━━━━━━┓
┃                                              ┃
┃  <b>${ name }</b> (<code>${ symbol }</code>)${ ' '.repeat(Math.max(0, 30 - name.length - symbol.length)) }┃
┃                                              ┃
┃  Price: <b>${ this._formatNumber(price) }</b>${ ' '.repeat(Math.max(0, 24 - this._formatNumber(price).length)) }┃
┃  1d: <span style="color:${ change1dColor }">${ trend1dEmoji } ${ change1dStr }</span>${ ' '.repeat(Math.max(0, 14 - change1dStr.length)) }7d: <span style="color:${ change7dColor }">${ trend7dEmoji } ${ change7dStr }</span>${ ' '.repeat(Math.max(0, 14 - change7dStr.length)) }┃
┃  MCap: ${ this._formatNumber(marketCap, true) }${ ' '.repeat(Math.max(0, 27 - this._formatNumber(marketCap, true).length)) }┃
┃  Vol: ${ this._formatNumber(volume, true) }${ ' '.repeat(Math.max(0, 28 - this._formatNumber(volume, true).length)) }┃`;

			// Add simple trend line
			const trendChars = [ '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█' ];
			let trendLine = '';

			// Simple algorithm to simulate a trend
			for(let i = 0; i < 25; i++) {
				const dayFraction = i / 24;
				const influence1d = Math.max(0, 1 - dayFraction) * change1d;
				const influence7d = dayFraction * change7d;
				const combined = (influence1d + influence7d) / 2;
				const normalized = (combined + 10) / 20; // Normalize to 0-1 range
				const charIndex = Math.min(Math.floor(normalized * trendChars.length), trendChars.length - 1);
				trendLine += trendChars[Math.max(0, charIndex)];
			}

			visual += `
┃  Trend: ${ trendLine }${ ' '.repeat(Math.max(0, 30 - trendLine.length)) }┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛</pre>`;

			return visual;
		} catch(error) {
			this.logger.warn('Error creating token dashboard', { err: error });
			return null;
		}
	}

	/**
	 * Create token comparison visual
	 */
	_createTokenComparison(recommendations) {
		try {
			const tokens = recommendations.slice(0, 5); // Limit to top 5

			let visual = `
<pre>┏━━━━━━━━━━ 🏆 TOP RECOMMENDATIONS 🏆 ━━━━━━━━━━┓
┃ Rank ┃ Token    ┃ Price ($)    ┃ 24h Change  ┃ Trend     ┃
┣━━━━━━╋━━━━━━━━━━╋━━━━━━━━━━━━━━━╋━━━━━━━━━━━━━╋━━━━━━━━━━━┫`;

			// Create rows for each token
			tokens.forEach((token, index) => {
				const rank = index + 1;
				const symbol = token.symbol || '???';
				const price = token.price_usd || 0;
				const change = token.price_change_1d || 0;
				const changeSymbol = change >= 0 ? '↗' : '↘';
				const changeValue = `${ change >= 0 ? '+' : '' }${ change.toFixed(1) }%`;
				const changeColor = change >= 0 ? 'green' : 'red';

				// Create mini trend visualization
				const trendChars = [ '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█' ];
				const normalizedChange = (change + 10) / 20; // Normalize to 0-1 range
				const trendIndex = Math.min(Math.floor(normalizedChange * trendChars.length), trendChars.length - 1);
				let trendVisual = '';

				for(let i = 0; i < trendChars.length; i++) {
					if(i === trendIndex) {
						trendVisual += (change >= 0) ? '█' : '▁';
					} else if(i < trendIndex && change >= 0) {
						trendVisual += trendChars[i];
					} else if(i > trendIndex && change < 0) {
						trendVisual += trendChars[trendChars.length - 1 - i];
					} else {
						trendVisual += ' ';
					}
				}

				visual += `
┃  ${ rank }   ┃ <code>${ symbol.padEnd(8) }</code> ┃ ${ this._formatNumber(price)
					.padStart(12) } ┃ <span style="color:${ changeColor }">${ changeSymbol } ${ changeValue.padStart(7) }</span> ┃ ${ trendVisual } ┃`;
			});

			// Add criteria info
			const criteria = recommendations[0]?.criteria || 'trending';
			const risk = recommendations[0]?.risk_level || 'medium';

			visual += `
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃ 🚀 Criteria: <b>${ criteria }</b> | Risk: <b>${ risk }</b>${ ' '.repeat(30 - criteria.length - risk.length) }┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛</pre>`;

			return visual;
		} catch(error) {
			this.logger.warn('Error creating token comparison', { err: error });
			return null;
		}
	}

	/**
	 * Create wallet portfolio visual
	 */
	_createWalletPortfolio(data) {
		try {
			if(!data.tokens || !data.tokens.data || data.tokens.data.length === 0) {
				return null;
			}

			const tokens = data.tokens.data.slice(0, 5); // Top 5 tokens
			const totalValue = data.tokens.totalTokenValueUsd ||
				tokens.reduce((sum, t) => sum + (t.valueUsd || 0), 0);

			if(totalValue <= 0) return null;

			// Shorten wallet address
			const walletAddr = data.wallet;
			const shortAddr = walletAddr.length > 20 ?
				`${ walletAddr.substring(0, 10) }...${ walletAddr.substring(walletAddr.length - 6) }` :
				walletAddr;

			// Handle total value change
			const totalChange = data.tokens.totalTokenValueUsd1dChange || 0;
			const changeColor = totalChange >= 0 ? 'green' : 'red';
			const changeFormatted = `${ totalChange >= 0 ? '+' : '' }${ this._formatNumber(totalChange) }`;

			let visual = `
<pre>┏━━━━━━━━━━ 💼 PORTFOLIO ANALYSIS 💼 ━━━━━━━━━━┓
┃ Wallet: <code>${ shortAddr }</code>${ ' '.repeat(Math.max(0, 24 - shortAddr.length)) }┃
┃ Total Value: <b>${ this._formatNumber(totalValue) }</b> <span style="color:${ changeColor }">(${ changeFormatted })</span>${ ' '.repeat(Math.max(0, 10 - this._formatNumber(totalValue).length - changeFormatted.length)) }┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃ Token     ┃ Value ($)        ┃    %    ┃ Distribution    ┃
┣━━━━━━━━━━━╋━━━━━━━━━━━━━━━━━━━╋━━━━━━━━━╋━━━━━━━━━━━━━━━━━┫`;

			// Create chart for each token
			tokens.forEach(token => {
				const value = token.valueUsd || 0;
				const percentage = (value / totalValue) * 100;
				const symbol = token.symbol || '???';
				const barLength = Math.max(1, Math.round(percentage / 5)); // 20 chars = 100%
				const bar = '█'.repeat(barLength) + '░'.repeat(20 - barLength);

				visual += `
┃ <code>${ symbol.padEnd(8) }</code> ┃ ${ this._formatNumber(value).padStart(15) } ┃ ${ percentage.toFixed(1)
					.padStart(5) }% ┃ ${ bar } ┃`;
			});

			// Additional information
			visual += `
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃ Total Tokens: <b>${ data.tokens.totalTokenCount || tokens.length }</b>${ ' '.repeat(Math.max(0, 36 - String(data.tokens.totalTokenCount || tokens.length).length)) }┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛</pre>`;

			return visual;
		} catch(error) {
			this.logger.warn('Error creating wallet portfolio', { err: error });
			return null;
		}
	}

	/**
	 * Create price prediction visual
	 */
	_createPricePrediction(data) {
		try {
			const symbol = data.tokenSymbol;
			const currentPrice = data.currentPrice || 0;
			const predictedPrice = data.prediction.predictedPrice || 0;
			const percentChange = data.prediction.percentChange || 0;
			const rangeLow = data.prediction.rangeLow || 0;
			const rangeHigh = data.prediction.rangeHigh || 0;
			const timeframe = data.timeframe || '7d';

			// Select visualization style based on prediction direction
			const isUp = percentChange >= 0;
			const changeColor = isUp ? 'green' : 'red';
			const trendSymbol = isUp ? '🚀' : '📉';
			const trendArrow = isUp ? '↗' : '↘';

			let visual = `
<pre>┏━━━━━━━━━━ 🔮 PRICE PREDICTION: <code>${ symbol }</code> ━━━━━━━━━━┓
┃                                                    ┃
┃  Current Price: <b>${ this._formatNumber(currentPrice) }</b>${ ' '.repeat(Math.max(0, 28 - this._formatNumber(currentPrice).length)) }┃
┃  Predicted (${ timeframe }): <b><span style="color:${ changeColor }">${ this._formatNumber(predictedPrice) }</span></b>${ ' '.repeat(Math.max(0, 24 - this._formatNumber(predictedPrice).length)) }┃
┃  Change: <span style="color:${ changeColor }">${ percentChange >= 0 ? '+' : '' }${ percentChange.toFixed(2) }%</span>${ ' '.repeat(Math.max(0, 38 - percentChange.toFixed(2).length)) }┃
┃                                                    ┃
┃  Prediction range:                                 ┃
┃  ${ this._formatNumber(rangeLow) } ${ '-'.repeat(30) } ${ this._formatNumber(rangeHigh) }  ┃`;

			// Add trend arrow visualization
			if(isUp) {
				visual += `
┃                                                    ┃
┃     Current                Predicted             ┃
┃       ${ this._formatNumber(currentPrice) }    ${ trendArrow.repeat(20) }    ${ this._formatNumber(predictedPrice) }       ┃`;
			} else {
				visual += `
┃                                                    ┃
┃     Current                Predicted             ┃
┃       ${ this._formatNumber(currentPrice) }    ${ trendArrow.repeat(20) }    ${ this._formatNumber(predictedPrice) }       ┃`;
			}

			// Add confidence level if available
			if(data.prediction.confidence) {
				visual += `
┃                                                    ┃
┃  Confidence: <b>${ data.prediction.confidence }</b>${ ' '.repeat(Math.max(0, 35 - String(data.prediction.confidence).length)) }┃`;
			}

			visual += `
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃  ${ trendSymbol } Projection based on historical data analysis${ ' '.repeat(8) }┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛</pre>`;

			return visual;
		} catch(error) {
			this.logger.warn('Error creating price prediction visual', { err: error });
			return null;
		}
	}

	/**
	 * Format a number for display
	 * @param {number} num - The number to format
	 * @param {boolean} useSuffix - Whether to use K, M, B, T suffixes for large numbers
	 * @returns {string} - Formatted number string
	 */
	_formatNumber(num, useSuffix = false) {
		try {
			if(num === null || num === undefined || num === '') return 'N/A';

			let number = Number(num);
			if(isNaN(number)) return 'N/A';

			if(useSuffix) {
				const absNum = Math.abs(number);
				if(absNum >= 1e12) return (number / 1e12).toFixed(2) + 'T';
				if(absNum >= 1e9) return (number / 1e9).toFixed(2) + 'B';
				if(absNum >= 1e6) return (number / 1e6).toFixed(2) + 'M';
				if(absNum >= 1e3) return (number / 1e3).toFixed(1) + 'K';
				if(absNum < 1 && absNum > 0) return number.toPrecision(2);
				return number.toFixed(0);
			}

			const absNum = Math.abs(number);
			let options = {};

			if(absNum === 0) {
				options = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
			} else if(absNum < 0.000001 && absNum !== 0) {
				// Use scientific notation for very small numbers
				return number.toExponential(2);
			} else if(absNum < 0.01) {
				options = { maximumSignificantDigits: 4 };
			} else if(absNum < 1) {
				options = { maximumFractionDigits: 4 };
			} else if(absNum < 10) {
				options = { maximumFractionDigits: 4 };
			} else if(absNum < 1000) {
				options = { maximumFractionDigits: 2 };
			} else {
				options = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
			}

			return number.toLocaleString('en-US', options);
		} catch(error) {
			this.logger.warn('Error formatting number', { err: error, value: num });
			return String(num || 'N/A');
		}
	}

	/**
	 * Escape HTML special characters
	 * @param {string} text - Raw text to escape
	 * @returns {string} - HTML-escaped text
	 */
	_escapeHtml(text) {
		if(!text || typeof text !== 'string') return '';

		return text
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#039;');
	}

	/**
	 * Strip HTML tags from text
	 * @param {string} html - HTML string
	 * @returns {string} - Plain text
	 */
	_stripHtml(html) {
		if(!html || typeof html !== 'string') return '';

		return html.replace(/<[^>]*>?/gm, '');
	}

	/**
	 * Handle errors in bot responses
	 * @param {object} ctx - Telegram context
	 * @param {Error} error - The error that occurred
	 * @param {string} stage - Where the error occurred
	 */
	_handleError(ctx, error, stage) {
		this.logger.error(`Error during stage: ${ stage }`, {
			err: error,
			error_message: error.message,
			stage: stage,
			telegramUserId: ctx?.from?.id,
			telegramChatId: ctx?.chat?.id,
		});

		if(!ctx || (typeof ctx.reply !== 'function' && typeof ctx.editMessageText !== 'function')) {
			this.logger.warn('Context not available for error handling', { stage });
			return;
		}

		// Determine user-friendly error message
		let userMessage = '🤖 Oh no! An unexpected error occurred. Please try again in a moment. If the problem persists, use /new to start fresh.';

		// ... (resto de tu código de manejo de errores)

		try {
			// Try to reply with HTML
			const message = `<b>⚠️ Error</b>\n\n${ this._escapeHtml(userMessage) }`;

			// Añadir stack trace si está en modo debug
			let fullMessage = message;
			if(this.debugMode && error?.stack) {
				const stackTrace = this._escapeHtml(error.stack);
				fullMessage += `\n\n<pre><code class="language-javascript">${ stackTrace }</code></pre>`;
			}

			if(ctx.callbackQuery && typeof ctx.editMessageText === 'function') {
				ctx.editMessageText(fullMessage, { parse_mode: 'HTML' }).catch(e => {
					// Si falla HTML, intentar con texto plano
					ctx.editMessageText(this._stripHtml(userMessage)).catch(() => {});
				});
			} else if(typeof ctx.reply === 'function') {
				ctx.reply(fullMessage, { parse_mode: 'HTML' }).catch(e => {
					// Si falla HTML, intentar con texto plano
					ctx.reply(this._stripHtml(userMessage)).catch(() => {});
				});
			}
		} catch(e) {
			this.logger.error('Failed to send error message to user', { err: e, originalError: error });
		}
	}

	/**
	 * Handle global errors from Telegraf
	 * @param {Error} error - The error that occurred
	 * @param {object} ctx - Telegram context
	 */
	_handleGlobalError(error, ctx) {
		this.logger.error('Unhandled Telegraf error caught by global handler', {
			err: error,
			errorMessage: error.message,
			errorCode: error.code,
			errorDescription: error.description,
			update: ctx?.update,
		});

		if(ctx && (typeof ctx.reply === 'function' || typeof ctx.editMessageText === 'function')) {
			const userMessage = '😥 Apologies! A critical error occurred. My team has been notified. Please try again later or use /new.';

			try {
				if(ctx.callbackQuery && typeof ctx.editMessageText === 'function') {
					ctx.editMessageText(userMessage).catch(() => {});
				} else if(typeof ctx.reply === 'function') {
					ctx.reply(userMessage).catch(() => {});
				}
			} catch(e) {
				this.logger.error('Catastrophic failure in error handler', { nestedError: e });
			}
		}
	}

	/**
	 * Get or create user and session context
	 * @param {object} ctx - Telegram context
	 * @returns {Promise<object>} User, session and chat context
	 */
	async _getOrCreateUserAndSession(ctx) {
		const telegramUserId = BigInt(ctx.from.id);
		const telegramChatId = BigInt(ctx.chat.id);
		const now = new Date();

		this.logger.info('Getting or creating user context...', {
			telegramUserId: telegramUserId.toString(),
			telegramChatId: telegramChatId.toString(),
		});

		try {
			// Find existing session
			let session = await this.prisma.telegramSession.findUnique({
				where: { telegramId: telegramUserId },
				include: {
					user: true,
					chats: {
						where: { platform: 'telegram', status: 'Active' },
						orderBy: { lastMessageAt: 'desc' },
						take: 1,
					},
				},
			});

			let user;
			let chat;

			if(session) {
				// Update existing session
				user = session.user;
				this.logger.info('Existing session found', { sessionId: session.id, userId: user.id });

				session = await this.prisma.telegramSession.update({
					where: { id: session.id },
					data: {
						telegramUsername: ctx.from.username,
						firstName: ctx.from.first_name,
						lastName: ctx.from.last_name,
						languageCode: ctx.from.language_code,
						isPremium: ctx.from.is_premium ?? session.isPremium,
						chatId: telegramChatId,
						chatType: ctx.chat.type,
						chatTitle: ctx.chat.type !== 'private' ? ctx.chat.title : null,
						lastInteraction: now,
						status: 'Active',
					},
					include: {
						user: true,
						chats: {
							where: { platform: 'telegram', status: 'Active' },
							orderBy: { lastMessageAt: 'desc' },
							take: 1,
						},
					},
				});

				const existingChat = session.chats?.[0];

				if(existingChat) {
					// Update existing chat
					chat = await this.prisma.chat.update({
						where: { id: existingChat.id },
						data: { lastMessageAt: now, status: 'Active' },
					});
					this.logger.info('Using existing active chat', { chatId: chat.id });
				} else {
					// Create new chat for existing session
					chat = await this.prisma.chat.create({
						data: {
							userId: user.id,
							sessionId: session.id,
							platform: 'telegram',
							title: ctx.chat.type !== 'private' ? ctx.chat.title : `Chat with ${ user.nicename || user.firstname || user.username }`,
							lastMessageAt: now,
							status: 'Active',
						},
					});
					this.logger.info('New chat created for existing session', {
						chatId: chat.id,
						sessionId: session.id,
					});
				}
			} else {
				// Create new user, session and chat in a transaction
				this.logger.info('Creating new user, session, and chat...');
				const username = ctx.from.username || `tg_${ telegramUserId }`;
				const nicename = ctx.from.first_name || username;

				const result = await this.prisma.$transaction(async (prisma) => {
					// Create or update user
					const newUser = await prisma.user.upsert({
						where: { username: username },
						update: {
							firstname: ctx.from.first_name,
							lastname: ctx.from.last_name,
							nicename: nicename,
							language: ctx.from.language_code || 'en',
							status: 'Active',
							modified: now,
						},
						create: {
							username: username,
							firstname: ctx.from.first_name,
							lastname: ctx.from.last_name,
							nicename: nicename,
							language: ctx.from.language_code || 'en',
							type: 'TelegramUser',
							status: 'Active',
							created: now,
							modified: now,
						},
					});

					// Create session
					const newSession = await prisma.telegramSession.create({
						data: {
							userId: newUser.id,
							telegramId: telegramUserId,
							telegramUsername: ctx.from.username,
							firstName: ctx.from.first_name,
							lastName: ctx.from.last_name,
							languageCode: ctx.from.language_code,
							isBot: ctx.from.is_bot || false,
							isPremium: ctx.from.is_premium,
							chatId: telegramChatId,
							chatType: ctx.chat.type,
							chatTitle: ctx.chat.type !== 'private' ? ctx.chat.title : null,
							lastInteraction: now,
							status: 'Active',
						},
					});

					// Create chat
					const newChat = await prisma.chat.create({
						data: {
							userId: newUser.id,
							sessionId: newSession.id,
							platform: 'telegram',
							title: ctx.chat.type !== 'private' ? ctx.chat.title : `Chat with ${ newUser.nicename || newUser.firstname || newUser.username }`,
							lastMessageAt: now,
							status: 'Active',
						},
					});

					return {
						user: newUser,
						session: { ...newSession, user: newUser, chats: [ newChat ] },
						chat: newChat,
					};
				});

				user = result.user;
				session = result.session;
				chat = result.chat;

				this.logger.info('Created new user, session, and chat', {
					userId: user.id,
					sessionId: session.id,
					chatId: chat.id,
				});
			}

			if(!user || !session || !chat) {
				throw new Error('Failed to establish user context');
			}

			this.logger.info('User context ready', {
				userId: user.id,
				sessionId: session.id,
				chatId: chat.id,
			});

			return { user, session, chat };
		} catch(error) {
			this.logger.error('Database error during user context setup', { err: error });
			throw error;
		}
	}

	/**
	 * Gracefully stop the bot
	 * @param {string} signal - The signal that triggered the shutdown
	 */
	async _stopGracefully(signal) {
		this.logger.info(`Received ${ signal }, initiating graceful shutdown...`);

		try {
			// Stop Telegraf polling
			this.bot.stop(signal);
			this.logger.info('Telegraf polling stopped.');

			// Disconnect Prisma
			await this.prisma.$disconnect();
			this.logger.info('Prisma connection closed.');

			this.logger.info('Graceful shutdown complete. Exiting process.');
			process.exit(0);
		} catch(error) {
			this.logger.error('Error during graceful shutdown', { err: error });
			process.exit(1);
		}
	}

	/**
	 * Helper to build token query text
	 */
	_buildTokenQueryText(action, symbol) {
		switch(action) {
			case 'info':
				return `analyze token ${ symbol } in detail with price data, market metrics, and recent performance`;
			case 'price':
				return `what is the current price of ${ symbol } with volume, market cap and 24h change`;
			case 'chart':
				return `show price chart and historical data for ${ symbol }`;
			case 'holders':
				return `who are the top holders of ${ symbol } and what percentage do they own`;
			case 'predict':
				return `predict the price of ${ symbol } based on market data and trends`;
			default:
				return `analyze token ${ symbol } ${ action } with detailed market data`;
		}
	}

	/**
	 * Helper to build generic action query text
	 */
	_buildGenericQueryText(action, params) {
		switch(action) {
			case 'market_overview':
				return 'provide a detailed market overview of Solana ecosystem with trending tokens, volume, and market trends';
			case 'more_recommendations':
				return 'recommend more diverse tokens on Solana with different risk levels and potential';
			case 'compare':
				if(params.length >= 2) {
					return `compare tokens ${ params[0] } and ${ params[1] } side by side with price, volume, market cap and trends`;
				} else {
					return 'compare the top trending tokens side by side with metrics and performance';
				}
			default:
				return action.replace(/_/g, ' ');
		}
	}

	/**
	 * Helper to build wallet query text
	 */
	_buildWalletQueryText(action, address) {
		if(!address) return 'explain how to analyze a Solana wallet';

		switch(action) {
			case 'info':
				return `analyze wallet ${ address } in detail with tokens, values and balances`;
			case 'tokens':
				return `what tokens does wallet ${ address } hold with values and balances`;
			case 'nfts':
				return `what NFTs does wallet ${ address } have in its collection`;
			case 'pnl':
				return `calculate and analyze the PnL for wallet ${ address } with details on gains and losses`;
			case 'activity':
				return `show recent transaction activity for wallet ${ address }`;
			case 'risk':
				return `analyze risk profile for wallet ${ address } based on holdings and activity`;
			default:
				return `analyze wallet ${ address } ${ action } with detailed data`;
		}
	}

	/**
	 * Helper to build alert query text
	 */
	_buildAlertQueryText(action, symbol, params) {
		switch(action) {
			case 'set':
				return `set price alert for ${ symbol } ${ params || 'above current price' } with notification`;
			case 'list':
				return 'show all my active price alerts with current status';
			case 'delete':
				return `delete my price alert for ${ symbol }`;
			default:
				return `manage price alert ${ action } ${ symbol } with notification settings`;
		}
	}

	/**
	 * Helper to build help query text
	 */
	_buildHelpQueryText(category) {
		switch(category) {
			case 'tokens':
				return 'recommend top trending tokens on Solana with medium risk level for short term investment';
			case 'wallets':
				return 'explain how to analyze a Solana wallet with examples of commands to check tokens, NFTs and PnL';
			case 'alerts':
				return 'show me how to set up price alerts for Solana tokens with specific examples for SOL and JUP';
			case 'commands':
				return 'list all available commands and explain what each one does with examples';
			default:
				return 'recommend trending tokens on Solana';
		}
	}

	/**
	 * Helper to build example query text
	 */
	_buildExampleQueryText(exampleType) {
		switch(exampleType) {
			case 'sol_price':
				return 'analyze SOL token price, volume, market cap and recent trends in detail';
			case 'recommend_tokens':
				return 'recommend me trending tokens with medium risk for short term investment. Include specific tokens like SOL, JUP and BONK in your analysis';
			default:
				return `analyze the ${ exampleType.replace(/_/g, ' ') } in detail with market data`;
		}
	}

	/**
	 * Handle callback queries (button clicks)
	 */
	/**
	 * Handle callback queries (button clicks)
	 */
	async _handleCallbackQuery(ctx) {
		if(!ctx.callbackQuery?.data) {
			this.logger.warn('Received callback query without data');
			try {
				await ctx.answerCbQuery('Invalid button press.');
			} catch(e) {
				// Ignore error on answering invalid callbacks
			}
			return;
		}

		const callbackData = ctx.callbackQuery.data;
		const originalMessage = ctx.callbackQuery.message;

		// Acknowledge immediately to avoid Telegram timeout
		try {
			await ctx.answerCbQuery('Processing...');
		} catch(ackError) {
			this.logger.warn('Failed to answer callback query (might be old)', {
				err: ackError,
				callbackData,
			});
			return;
		}

		this.logger.info('Processing callback query', {
			callbackData,
			chatId: ctx.chat?.id,
			userId: ctx.from?.id,
			messageId: originalMessage?.message_id,
		});

		try {
			// Get user context
			const { user, chat, session } = await this._getOrCreateUserAndSession(ctx);

			// Parse the callback data
			const [ actionType, ...params ] = callbackData.split(':');

			// Show typing indicator
			await ctx.sendChatAction('typing');

			// Update original message to show processing
			let processingMessage;
			try {
				// Create appropriate processing message based on action type
				let processingText = `⏳ <b>PROCESSING REQUEST</b>\n\nProcessing ${ actionType.replace('_', ' ') }...`;

				// More specific messages for common actions
				if(actionType === 'token' && params[0]) {
					processingText = `⏳ <b>ANALYZING ${ params[1]?.toUpperCase() || 'TOKEN' }</b>\n\nFetching token data...`;
				} else if(actionType === 'action' && params[0] === 'explore_top_tokens') {
					processingText = '⏳ <b>DISCOVERING TOP TOKENS</b>\n\nAnalyzing market data...';
				}

				// Edit original message to show processing
				processingMessage = await ctx.editMessageText(processingText, { parse_mode: 'HTML' });
			} catch(editError) {
				this.logger.warn('Failed to edit message for processing', { err: editError });
				// Send a new message if editing fails
				processingMessage = await ctx.reply('⏳ <b>Processing your request...</b>', { parse_mode: 'HTML' });
			}

			// Create progress callback
			const progressCallback = async (stage, detail) => {
				try {
					let stageEmoji = '⏳';
					let stageTitle = stage.toUpperCase();

					// Map stages to emojis and titles
					switch(stage) {
						case 'setup':
							stageEmoji = '🔄';
							stageTitle = 'INITIALIZING';
							break;
						case 'memory_consultation':
							stageEmoji = '🧠';
							stageTitle = 'CHECKING MEMORY';
							break;
						case 'token_resolution':
							stageEmoji = '🔍';
							stageTitle = 'IDENTIFYING TOKENS';
							break;
						case 'main_consultation':
							stageEmoji = '⚙️';
							stageTitle = 'PROCESSING REQUEST';
							break;
						case 'executing_tools':
							stageEmoji = '🛠️';
							stageTitle = 'EXECUTING ACTIONS';
							break;
						case 'synthesis':
							stageEmoji = '📊';
							stageTitle = 'ANALYZING RESULTS';
							break;
						case 'finalizing':
							stageEmoji = '✨';
							stageTitle = 'FINALIZING RESPONSE';
							break;
						case 'complete':
							stageEmoji = '✅';
							stageTitle = 'COMPLETED';
							break;
						case 'error':
							stageEmoji = '❌';
							stageTitle = 'ERROR';
							break;
					}

					// Update processing message with progress
					if(processingMessage) {
						await ctx.telegram.editMessageText(
							ctx.chat.id,
							processingMessage.message_id,
							null,
							`${ stageEmoji } <b>${ stageTitle }</b>\n${ detail ? `\n${ this._escapeHtml(detail) }` : '' }`,
							{ parse_mode: 'HTML' },
						).catch(() => {});
					}

					// Keep typing indicator for long operations
					if([ 'main_consultation', 'executing_tools', 'synthesis' ].includes(stage)) {
						await ctx.sendChatAction('typing').catch(() => {});
					}
				} catch(error) {
					this.logger.warn('Error in progress callback during callback processing', { err: error });
				}
			};

			// Handle different action types with progress feedback
			let queryText = '';
			let response;

			switch(actionType) {
				case 'help':
					queryText = this._buildHelpQueryText(params[0]);
					response = await this.conversationService.sendMessage(
						user.id, chat.id, queryText, session.id, progressCallback,
						{
							system_directive: 'USE_TOOLS_ALWAYS',
							priority_tools: [ 'recommend_tokens', 'fetch_top_tokens', 'analyze_token_trend' ],
						},
					);
					break;

				case 'example':
					queryText = this._buildExampleQueryText(params[0]);
					response = await this.conversationService.sendMessage(
						user.id, chat.id, queryText, session.id, progressCallback,
						{
							system_directive: 'USE_TOOLS_ALWAYS',
							priority_tools: [ 'fetch_token_data', 'recommend_tokens', 'fetch_token_price_history' ],
						},
					);
					break;

				case 'token':
					const symbol = params[1] || '';
					queryText = this._buildTokenQueryText(params[0], symbol);

					response = await this.conversationService.sendMessage(
						user.id, chat.id, queryText, session.id, progressCallback,
						{
							system_directive: 'USE_TOOLS_ALWAYS',
							priority_tools: [ 'fetch_token_data', 'fetch_token_price_history' ],
						},
					);
					break;

				case 'action':
					if(params[0] === 'explore_top_tokens') {
						queryText = 'recommend top trending tokens on Solana with market data right now';

						response = await this.conversationService.sendMessage(
							user.id, chat.id, queryText, session.id, progressCallback,
							{
								system_directive: 'USE_TOOLS_ALWAYS',
								priority_tools: [ 'recommend_tokens', 'fetch_top_tokens' ],
							},
						);
					} else if(params[0] === 'show_help') {
						return this._handleHelp(ctx);
					} else {
						// Generic action handling
						queryText = this._buildGenericQueryText(params[0], params.slice(1));

						response = await this.conversationService.sendMessage(
							user.id, chat.id, queryText, session.id, progressCallback,
							{
								system_directive: 'USE_TOOLS_ALWAYS',
								priority_tools: [ 'recommend_tokens', 'fetch_top_tokens', 'compare_tokens' ],
							},
						);
					}
					break;

				case 'wallet':
					queryText = this._buildWalletQueryText(params[0], params[1]);
					response = await this.conversationService.sendMessage(
						user.id, chat.id, queryText, session.id, progressCallback,
						{
							system_directive: 'USE_TOOLS_ALWAYS',
							priority_tools: [ 'fetch_wallet_data', 'fetch_wallet_pnl', 'get_wallet_tokens_time_series' ],
						},
					);
					break;

				case 'alert':
					queryText = this._buildAlertQueryText(params[0], params[1], params[2]);
					response = await this.conversationService.sendMessage(
						user.id, chat.id, queryText, session.id, progressCallback,
						{
							system_directive: 'USE_TOOLS_ALWAYS',
							priority_tools: [ 'create_price_alert', 'schedule_alert' ],
						},
					);
					break;

				default:
					// Default handling
					queryText = `analyze ${ callbackData.replace(':', ' ') } with market data`;

					response = await this.conversationService.sendMessage(
						user.id, chat.id, queryText, session.id, progressCallback,
					);
			}

			// Update or send new message with response
			if(processingMessage) {
				try {
					// Eliminar el mensaje de procesamiento
					await ctx.telegram.deleteMessage(ctx.chat.id, processingMessage.message_id);
					// Enviar respuesta usando la nueva función
					await this.sendEnhancedResponse(ctx, response);
				} catch(error) {
					this.logger.error('Error updating message after callback', { err: error });
					// Si falla, enviar como nuevo mensaje
					await this.sendEnhancedResponse(ctx, response);
				}
			} else {
				// Enviar como nuevo mensaje si no hay mensaje de procesamiento
				await this.sendEnhancedResponse(ctx, response);
			}
		} catch(error) {
			this._handleError(ctx, error, 'callback_query_processing');
		}
	}

	// --- Función _formatPriceHistoryInfo (CORREGIDA para eliminar spans inválidos) ---
	/**
	 * Formatea los datos del historial de precios para una buena UX en Telegram.
	 * @param {object} historyData - El objeto que contiene los datos del historial (puede ser structuredData o structuredData.data).
	 * @returns {string | null} - Un string HTML formateado o null si los datos son inválidos.
	 */
	async _formatPriceHistoryInfo(historyData) {
		// La validación inicial robusta
		if(!historyData || !historyData.priceData || !Array.isArray(historyData.priceData.data) || historyData.priceData.data.length === 0) {
			this.logger.warn('[_formatPriceHistoryInfo] Invalid or empty price history data received.');
			return null;
		}

		const pricePoints = historyData.priceData.data;
		// Obtener la dirección. Puede estar en historyData.token (plano) o historyData.data.token (anidado), o si historyData ES structuredData.data, entonces está en historyData.token
		const tokenAddress = historyData.token; // Asume que la dirección está directamente en el objeto que le pasamos
		const resolution = historyData.resolution || 'Unknown';

		if(!tokenAddress || typeof tokenAddress !== 'string') {
			this.logger.warn('[_formatPriceHistoryInfo] Could not determine token address from historyData.', { historyData });
			return '<b>Error: Token address missing in history data.</b>';
		}

		// --- MEJORA UX: Intentar obtener Símbolo/Nombre del token ---
		// CORREGIDO: Quitado el span inválido del fallback
		let tokenDisplay = `<code>${ tokenAddress.substring(0, 6) }...${ tokenAddress.substring(tokenAddress.length - 4) }</code>`;
		try {
			// REEMPLAZA ESTO con tu lógica real de DB si tienes mapeo address -> symbol/name
			const tokenMeta = await this.prisma.tokenMetadata?.findUnique({
				where: { address: tokenAddress }, select: { symbol: true, name: true },
			});
			// CORREGIDO: Quitado el span inválido
			if(tokenMeta?.symbol) {
				tokenDisplay = `<b>${ this._escapeHtml(tokenMeta.name || tokenMeta.symbol) }</b> (<code>${ this._escapeHtml(tokenMeta.symbol) }</code>)`;
			} else {
				this.logger.warn(`[_formatPriceHistoryInfo] Could not find symbol/name for address: ${ tokenAddress }`);
			}
		} catch(dbError) {
			// No loguear error si simplemente no se encontró, solo si hubo error de DB
			if(!(dbError instanceof PrismaClientKnownRequestError && dbError.code === 'P2025')) { // Código P2025 es 'Record not found'
				this.logger.error('[_formatPriceHistoryInfo] Error fetching token metadata from DB', { err: dbError });
			} else {
				this.logger.info(`[_formatPriceHistoryInfo] No metadata record found for address: ${ tokenAddress }`);
			}
		}
		// --- Fin Mejora UX ---

		try {
			// Calcular Estadísticas Clave (con chequeos NaN)
			const firstPoint = pricePoints[0];
			const lastPoint = pricePoints[pricePoints.length - 1];
			const startDate = new Date(firstPoint.time * 1000);
			const endDate = new Date(lastPoint.time * 1000);
			const startPrice = parseFloat(firstPoint.open);
			const endPrice = parseFloat(lastPoint.close);

			let overallChange = NaN;
			if(!isNaN(startPrice) && !isNaN(endPrice) && startPrice !== 0) {
				overallChange = ((endPrice - startPrice) / startPrice) * 100;
			}
			const changeEmoji = isNaN(overallChange) ? '❓' : (overallChange >= 0 ? '📈' : '📉');
			const changeSign = isNaN(overallChange) ? '' : (overallChange >= 0 ? '+' : '');
			const changeText = isNaN(overallChange) ? 'N/A' : `${ changeSign }${ overallChange.toFixed(2) }%`;

			let highestHigh = -Infinity;
			let lowestLow = Infinity;
			pricePoints.forEach(p => {
				const high = parseFloat(p.high);
				const low = parseFloat(p.low);
				if(!isNaN(high) && high > highestHigh) highestHigh = high;
				if(!isNaN(low) && low < lowestLow) lowestLow = low;
			});
			if(highestHigh === -Infinity) highestHigh = NaN;
			if(lowestLow === Infinity) lowestLow = NaN;

			// Formatear Fechas
			const dateFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' };
			const startDateStr = !isNaN(startDate.getTime()) ? startDate.toLocaleDateString('en-US', dateFormatOptions) : 'N/A';
			const endDateStr = !isNaN(endDate.getTime()) ? endDate.toLocaleDateString('en-US', dateFormatOptions) : 'N/A';

			// Construir Tarjeta HTML (SIN SPANS INVÁLIDOS)
			let card = `📊 <b>PRICE HISTORY - ${ tokenDisplay }</b> 📊\n\n`; // Header
			card += `<b>Resolution:</b> ${ this._escapeHtml(resolution) }\n`;
			card += `<b>Period:</b> ${ startDateStr } to ${ endDateStr }\n\n`;
			card += `<b>Latest Price:</b> $${ this._formatNumber(endPrice) }\n`;
			// CORREGIDO: Quitado el span inválido
			card += `<b>Overall Change:</b> ${ changeEmoji } <b>${ changeText }</b>\n`;
			card += `<b>Highest High:</b> $${ this._formatNumber(highestHigh) }\n`;
			card += `<b>Lowest Low:</b> $${ this._formatNumber(lowestLow) }\n\n`;

			const trendPoints = pricePoints.slice(-7);
			if(trendPoints.length > 1) {
				const firstTrend = parseFloat(trendPoints[0].close);
				const lastTrend = parseFloat(trendPoints[trendPoints.length - 1].close);
				if(!isNaN(firstTrend) && !isNaN(lastTrend)) {
					const trendEmoji = lastTrend > firstTrend ? '↗️' : (lastTrend < firstTrend ? '↘️' : '➡️');
					card += `<b>Recent Trend (${ trendPoints.length } points):</b> ${ trendEmoji }\n`;
				}
			}
			card += `\n<i>Source: Vybe Network API (History)</i>`;

			this.logger.info('[_formatPriceHistoryInfo] Successfully formatted price history card.');
			return card;

		} catch(error) {
			this.logger.error('[_formatPriceHistoryInfo] Error formatting history data', {
				err: error,
				input: JSON.stringify(historyData), // Loguear el input ayuda a depurar
			});
			return `<b>Error displaying price history for ${ tokenDisplay }.</b>`;
		}
	}

	_formatTokenHoldersInfo(holdersData) {
		try {
			if(!holdersData || !holdersData.data || !Array.isArray(holdersData.data.holdersData?.data) ||
				holdersData.data.holdersData.data.length === 0) {
				this.logger.warn('[_formatTokenHoldersInfo] Invalid holders data structure');
				return null;
			}

			const holders = holdersData.data.holdersData.data;
			const tokenSymbol = holders[0]?.tokenSymbol || 'Token';
			const tokenAddress = holdersData.data.token || holders[0]?.tokenMint || '';

			// Header with token information
			let output = `<b>💰 TOP HOLDERS OF ${ tokenSymbol }</b>\n\n`;

			// Summary information about holders
			const totalHolding = holders.reduce((sum, h) => sum + parseFloat(h.percentageOfSupplyHeld || 0), 0);
			output += `<b>📊 SUMMARY</b>\n`;
			output += `• Token: <code>${ tokenSymbol }</code>\n`;
			output += `• Holders shown: <b>${ holders.length }</b>\n`;
			output += `• % of supply held: <b>${ totalHolding.toFixed(2) }%</b>\n\n`;

			// Holders table
			output += `<b>🏆 TOP HOLDERS</b>\n\n`;

			// Create rows for each holder (limit to 10 to avoid very long messages)
			holders.slice(0, 10).forEach((holder, index) => {
				const rankEmoji = index < 3 ? [ '🥇', '🥈', '🥉' ][index] : `${ index + 1 }.`;
				const address = holder.ownerAddress;
				const shortAddr = address ?
					`${ address.substring(0, 6) }...${ address.substring(address.length - 4) }` :
					'Unknown';
				const name = holder.ownerName || shortAddr;
				const balance = this._formatNumber(parseFloat(holder.balance));
				const valueUsd = this._formatNumber(parseFloat(holder.valueUsd));
				const percentage = parseFloat(holder.percentageOfSupplyHeld).toFixed(4);

				// Visual percentage bar (each █ represents ~0.05% for example)
				const barLength = Math.max(1, Math.min(20, Math.floor(holder.percentageOfSupplyHeld * 20)));
				const bar = '█'.repeat(barLength) + '▒'.repeat(20 - barLength);

				output += `${ rankEmoji } <b>${ name }</b>\n`;
				output += `   Balance: <b>${ balance }</b> (≈$${ valueUsd })\n`;
				output += `   ${ bar } <b>${ percentage }%</b>\n\n`;
			});

			// Footer
			output += `<i>Data provided by Vybe Network API</i>`;

			return output;
		} catch(error) {
			this.logger.error('[_formatTokenHoldersInfo] Error formatting holders data', {
				err: error,
				errorMessage: error.message,
			});
			return null;
		}

	}

	/**
	 * Formats wallet information with enhanced visual presentation
	 * @param {object} walletData - The wallet data to format
	 * @returns {string} HTML formatted card for display
	 */
	_formatWalletInfo(walletData) {
		try {
			if(!walletData) {
				this.logger.warn('[_formatWalletInfo] Called with null or undefined wallet data');
				return null;
			}

			this.logger.info('[_formatWalletInfo] Processing wallet data', {
				dataPreview: JSON.stringify(walletData?.data || walletData).substring(0, 200) + '...',
			});

			// Extract wallet address from various possible locations
			let walletAddress = null;
			if(walletData.wallet) {
				walletAddress = walletData.wallet;
			} else if(walletData.data?.wallet) {
				walletAddress = walletData.data.wallet;
			} else if(walletData.data?.tokens?.ownerAddress) {
				walletAddress = walletData.data.tokens.ownerAddress;
			}

			if(!walletAddress) {
				this.logger.warn('[_formatWalletInfo] No wallet address found in data');
				return null;
			}

			// Get tokens data from the correct location
			const tokensData = walletData.data?.tokens || walletData.tokens;
			if(!tokensData || !tokensData.data || !Array.isArray(tokensData.data)) {
				this.logger.warn('[_formatWalletInfo] No valid tokens array found in wallet data');
				return '<b>💼 WALLET ANALYSIS</b>\n\n' +
					`<b>Address:</b> <code>${ this._shortenAddress(walletAddress) }</code>\n` +
					'<i>No token data available for this wallet</i>';
			}

			// Get NFT data if available
			const nftsData = walletData.data?.nfts || walletData.nfts;
			const hasNfts = nftsData && nftsData.data && Array.isArray(nftsData.data) && nftsData.data.length > 0;

			// Format shortened wallet address
			const shortAddr = this._shortenAddress(walletAddress);

			// Portfolio value and metrics
			const totalValue = tokensData.totalTokenValueUsd || 0;
			const valueChange = tokensData.totalTokenValueUsd1dChange || 0;
			const changeEmoji = valueChange >= 0 ? '📈' : '📉';
			const changeSign = valueChange >= 0 ? '+' : '';
			const tokenCount = tokensData.totalTokenCount || tokensData.data.length || 0;

			// Build the header section
			let card = `<b>💼 WALLET ANALYSIS</b>\n\n`;
			card += `<b>Address:</b> <code>${ shortAddr }</code>\n\n`;

			// Portfolio value section
			card += `<b>📊 PORTFOLIO VALUE</b>\n`;
			card += `• Total Value: <b>$${ this._formatNumber(totalValue) }</b>\n`;
			card += `• 24h Change: ${ changeEmoji } <b>${ changeSign }$${ this._formatNumber(Math.abs(valueChange)) }</b>\n`;
			card += `• Tokens Held: <b>${ tokenCount }</b>\n`;
			if(hasNfts) {
				card += `• NFT Collections: <b>${ nftsData.totalNftCollectionCount || nftsData.data.length }</b>\n`;
			}

			// Top holdings section
			if(tokensData.data.length > 0) {
				// Create visual bar for portfolio distribution
				const topTokens = tokensData.data.slice(0, 5); // Limit to top 5

				card += `\n<b>🏆 TOP HOLDINGS</b>\n`;

				topTokens.forEach((token, index) => {
					const symbol = token.symbol || 'UNKNOWN';
					const balance = this._formatNumber(token.amount || token.balance || 0);
					const valueUsd = this._formatNumber(token.valueUsd || token.priceUsd * token.amount || 0);
					const percentage = totalValue > 0 ? ((token.valueUsd || 0) / totalValue * 100) : 0;

					// Create simple bar chart with percentage
					const barLength = Math.min(10, Math.round(percentage / 10)); // Scale to max 10 chars
					const bar = barLength > 0 ? '█'.repeat(barLength) + '▒'.repeat(10 - barLength) : '▒'.repeat(10);

					card += `${ index + 1 }. <code>${ symbol }</code>: ${ balance }\n`;
					card += `   $${ valueUsd } ${ bar } <b>${ percentage.toFixed(1) }%</b>\n`;
				});
			}

			// Footer with sol explorer link
			card += `\n<i>Data provided by Vybe Network API • ${ this._formatDate(new Date()) }</i>`;

			return card;
		} catch(error) {
			this.logger.error('[_formatWalletInfo] Error formatting wallet info', {
				err: error,
				stackTrace: error.stack,
			});
			return `<b>💼 WALLET ANALYSIS</b>\n\n<i>Error formatting wallet data: ${ error.message }</i>`;
		}
	}

	/**
	 * Helper method to shorten wallet/token addresses
	 * @param {string} address - The full address
	 * @returns {string} Shortened address
	 */
	_shortenAddress(address) {
		if(!address || typeof address !== 'string') return 'Unknown';
		if(address.length <= 16) return address;
		return `${ address.substring(0, 6) }...${ address.substring(address.length - 4) }`;
	}

	/**
	 * Helper method to format dates
	 * @param {Date} date - Date to format
	 * @returns {string} Formatted date string
	 */
	_formatDate(date) {
		try {
			if(!date || !(date instanceof Date) || isNaN(date.getTime())) {
				return 'Unknown date';
			}
			return date.toLocaleString('en-US', {
				month: 'short',
				day: 'numeric',
				hour: '2-digit',
				minute: '2-digit',
			});
		} catch(e) {
			return 'Date error';
		}
	}

	/**
	 * Formatter específico para datos de TimeSeries de Wallet
	 * Añade este método a tu clase TelegramBotService
	 */
	_formatWalletTimeSeriesInfo(timeSeriesData) {
		try {
			if(!timeSeriesData || !timeSeriesData.data) {
				this.logger.warn('[_formatWalletTimeSeriesInfo] Called with null or invalid data');
				return null;
			}

			this.logger.info('[_formatWalletTimeSeriesInfo] Processing wallet time series data', {
				dataPreview: JSON.stringify(timeSeriesData.data).substring(0, 200) + '...',
			});

			// Extraer la dirección de la wallet
			const walletAddress = timeSeriesData.data.wallet ||
				timeSeriesData.wallet ||
				(timeSeriesData.data.timeSeriesData &&
					(timeSeriesData.data.timeSeriesData.ownerAddress ||
						(Array.isArray(timeSeriesData.data.timeSeriesData.data) &&
							timeSeriesData.data.timeSeriesData.data[0]?.ownerAddress)));

			if(!walletAddress) {
				this.logger.warn('[_formatWalletTimeSeriesInfo] No wallet address found in time series data');
				return null;
			}

			const shortAddr = this._shortenAddress(walletAddress);

			// Extraer los datos de serie temporal
			let timeSeriesArray = [];
			if(timeSeriesData.data.timeSeriesData) {
				if(Array.isArray(timeSeriesData.data.timeSeriesData)) {
					timeSeriesArray = timeSeriesData.data.timeSeriesData;
				} else if(timeSeriesData.data.timeSeriesData.data && Array.isArray(timeSeriesData.data.timeSeriesData.data)) {
					timeSeriesArray = timeSeriesData.data.timeSeriesData.data;
				} else if(Array.isArray(timeSeriesData.data.timeSeriesData.ownerAddress)) {
					timeSeriesArray = timeSeriesData.data.timeSeriesData.ownerAddress;
				}
			}

			if(timeSeriesArray.length === 0) {
				this.logger.warn('[_formatWalletTimeSeriesInfo] No time series array found in data');
				return `<b>📈 WALLET VALUE HISTORY</b>\n\n` +
					`<b>Address:</b> <code>${ shortAddr }</code>\n` +
					`<i>No historical data available for this wallet</i>`;
			}

			// Ordenar datos por fecha
			const sortedData = [ ...timeSeriesArray ].sort((a, b) =>
				(a.blockTime || a.timestamp || 0) - (b.blockTime || b.timestamp || 0),
			);

			// Obtener el primer y último punto para el resumen general
			const firstPoint = sortedData[0];
			const lastPoint = sortedData[sortedData.length - 1];

			// Calcular valor total (tokenValue + systemValue + stakeValue)
			const getTotal = (point) => {
				return parseFloat(point.tokenValue || 0) +
					parseFloat(point.systemValue || 0) +
					parseFloat(point.stakeValue || 0);
			};

			const startValue = getTotal(firstPoint);
			const endValue = getTotal(lastPoint);
			const days = timeSeriesData.data.days || Math.round(sortedData.length / 3); // Estimar días

			// Calcular métricas de rendimiento
			const absoluteChange = endValue - startValue;
			const percentChange = startValue > 0 ? (absoluteChange / startValue) * 100 : 0;
			const changeEmoji = absoluteChange >= 0 ? '📈' : '📉';
			const changeSign = absoluteChange >= 0 ? '+' : '';

			// Formatear fechas
			const startDate = new Date((firstPoint.blockTime || firstPoint.timestamp) * 1000);
			const endDate = new Date((lastPoint.blockTime || lastPoint.timestamp) * 1000);
			const dateOptions = { month: 'short', day: 'numeric' };

			// Construcción de la tarjeta con el análisis
			let card = `<b>📈 WALLET VALUE HISTORY</b>\n\n`;
			card += `<b>Address:</b> <code>${ shortAddr }</code>\n\n`;

			// Sección de resumen
			card += `<b>💰 VALUE ANALYSIS (${ days } days)</b>\n`;
			card += `• Period: <b>${ startDate.toLocaleDateString('en-US', dateOptions) } - ${ endDate.toLocaleDateString('en-US', dateOptions) }</b>\n`;
			card += `• Starting Value: <b>$${ this._formatNumber(startValue) }</b>\n`;
			card += `• Current Value: <b>$${ this._formatNumber(endValue) }</b>\n`;
			card += `• Change: ${ changeEmoji } <b>${ changeSign }$${ this._formatNumber(Math.abs(absoluteChange)) } (${ changeSign }${ percentChange.toFixed(2) }%)</b>\n\n`;

			// Gráfico de tendencia de valor
			card += `<b>📊 VALUE TREND</b>\n`;

			// Obtener puntos de muestra para el gráfico (hasta 10 puntos)
			const sampleSize = Math.min(10, sortedData.length);
			const step = Math.max(1, Math.floor(sortedData.length / sampleSize));
			const samplePoints = [];

			for(let i = 0; i < sortedData.length; i += step) {
				if(samplePoints.length < sampleSize) {
					samplePoints.push(sortedData[i]);
				}
			}

			// Asegurar que el último punto esté incluido
			if(samplePoints[samplePoints.length - 1] !== lastPoint) {
				samplePoints[samplePoints.length - 1] = lastPoint;
			}

			// Encontrar valores mínimo y máximo para la escala
			const values = samplePoints.map(point => getTotal(point));
			const minValue = Math.min(...values);
			const maxValue = Math.max(...values);
			const range = maxValue - minValue;

			// Crear el gráfico con 8 niveles
			const chartChars = [ '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█' ];

			// Generar el gráfico
			let chartLine = '';
			let dateLabels = '';

			samplePoints.forEach((point, index) => {
				const total = getTotal(point);
				// Escalar al rango del gráfico
				const normalizedValue = range > 0 ?
					(total - minValue) / range : 0.5;
				const barIndex = Math.min(chartChars.length - 1,
					Math.floor(normalizedValue * chartChars.length));
				chartLine += chartChars[barIndex];

				// Añadir marcas de fecha para algunos puntos (primero, último y puntos intermedios)
				if(index === 0 || index === samplePoints.length - 1 ||
					index === Math.floor(samplePoints.length / 2)) {
					const date = new Date((point.blockTime || point.timestamp) * 1000);
					const day = date.getDate();
					dateLabels += `${ day }${ ' '.repeat(Math.max(0, chartChars.length / samplePoints.length)) }`;
				}
			});

			card += `<pre>${ chartLine }</pre>\n`;

			// Distribución de valor actual
			if(lastPoint.tokenValue || lastPoint.systemValue || lastPoint.stakeValue) {
				const tokenVal = parseFloat(lastPoint.tokenValue || 0);
				const systemVal = parseFloat(lastPoint.systemValue || 0);
				const stakeVal = parseFloat(lastPoint.stakeValue || 0);
				const total = tokenVal + systemVal + stakeVal;

				if(total > 0) {
					card += `<b>🔄 CURRENT VALUE DISTRIBUTION</b>\n`;

					// Tokens value
					if(tokenVal > 0) {
						const tokenPct = (tokenVal / total * 100).toFixed(1);
						// Visual bar for percentage
						const barLength = Math.round(tokenPct / 10); // 10 chars = 100%
						const bar = '█'.repeat(barLength) + '▒'.repeat(10 - barLength);
						card += `• Tokens: <b>$${ this._formatNumber(tokenVal) }</b> ${ bar } ${ tokenPct }%\n`;
					}

					// SOL value
					if(systemVal > 0) {
						const systemPct = (systemVal / total * 100).toFixed(1);
						const barLength = Math.round(systemPct / 10);
						const bar = '█'.repeat(barLength) + '▒'.repeat(10 - barLength);
						card += `• SOL: <b>$${ this._formatNumber(systemVal) }</b> ${ bar } ${ systemPct }%\n`;
					}

					// Staked value
					if(stakeVal > 0) {
						const stakePct = (stakeVal / total * 100).toFixed(1);
						const barLength = Math.round(stakePct / 10);
						const bar = '█'.repeat(barLength) + '▒'.repeat(10 - barLength);
						card += `• Staked: <b>$${ this._formatNumber(stakeVal) }</b> ${ bar } ${ stakePct }%\n`;
					}
				}
			}

			// Añadir recomendación o consejo
			if(percentChange > 20) {
				card += `\n<b>💡 INSIGHTS:</b> This wallet has shown strong growth (${ percentChange.toFixed(1) }%) over the analyzed period.\n`;
			} else if(percentChange < -20) {
				card += `\n<b>💡 INSIGHTS:</b> This wallet has experienced significant decline (${ percentChange.toFixed(1) }%) in the analyzed period.\n`;
			} else {
				card += `\n<b>💡 INSIGHTS:</b> This wallet's value has remained relatively stable over the analyzed period.\n`;
			}

			// Pie de página
			card += `\n<i>Data provided by Vybe Network API • ${ this._formatDate(new Date()) }</i>`;

			return card;
		} catch(error) {
			this.logger.error('[_formatWalletTimeSeriesInfo] Error formatting wallet time series data', {
				err: error,
				errorMessage: error.message,
				stackTrace: error.stack,
			});
			return `<b>📈 WALLET VALUE HISTORY</b>\n\n` +
				`<i>Error formatting historical data: ${ error.message }</i>`;
		}
	}

	/**
	 * Formatter especializado para datos de Top Tokens
	 * Añade este método a tu clase TelegramBotService
	 */
	_formatTopTokensInfo(tokensData) {
		try {
			if(!tokensData || !tokensData.data) {
				this.logger.warn('[_formatTopTokensInfo] Called with null or invalid data');
				return null;
			}

			this.logger.info('[_formatTopTokensInfo] Processing top tokens data', {
				dataPreview: JSON.stringify(tokensData.data).substring(0, 200) + '...',
			});

			// Extraer los datos de tokens
			let tokensList = [];
			if(tokensData.data.tokens && tokensData.data.tokens.data) {
				tokensList = tokensData.data.tokens.data;
			} else if(Array.isArray(tokensData.data)) {
				tokensList = tokensData.data;
			}

			if(!tokensList || tokensList.length === 0) {
				this.logger.warn('[_formatTopTokensInfo] No tokens found in data');
				return '<b>🏆 TOP TOKENS</b>\n\n<i>No token data available</i>';
			}

			// Limitar a 10 tokens para evitar mensajes muy largos
			const topTokens = tokensList.slice(0, 10);

			// Determinar criterio de ordenación
			const sortBy = tokensData.data.sortBy || 'marketCap';
			const order = tokensData.data.order || 'desc';
			const page = tokensData.data.page || 1;

			// Construcción de la tarjeta con el listado
			let card = `<b>🏆 TOP TOKENS BY ${ sortBy.toUpperCase() }</b>\n\n`;

			// Tabla de tokens con estilo visual
			topTokens.forEach((token, index) => {
				const symbol = token.symbol || 'UNKNOWN';
				const name = token.name || symbol;
				const price = parseFloat(token.price || 0);

				// Determinar qué cambio de precio usar (1d o 7d)
				let priceChange = parseFloat(token.price1d || token.price_change_24h || 0);
				const timeframe = token.price1d !== undefined ? '24h' : '7d';

				// Si no hay cambio a 1d, intentar con 7d
				if(priceChange === 0 && (token.price7d !== undefined || token.price_change_7d !== undefined)) {
					priceChange = parseFloat(token.price7d || token.price_change_7d || 0);
				}

				// Formatear cambio de precio con emoji
				const changeEmoji = priceChange > 0 ? '📈' : (priceChange < 0 ? '📉' : '➡️');
				const changeSign = priceChange > 0 ? '+' : '';
				const changeText = `${ changeSign }${ priceChange !== 0 ? priceChange.toFixed(2) : '0.00' }%`;

				// Formatear market cap
				const marketCap = parseFloat(token.marketCap || 0);

				// Formatear rank con emoji según posición
				const rankEmoji = index === 0 ? '🥇' : (index === 1 ? '🥈' : (index === 2 ? '🥉' : `${ index + 1 }.`));

				// Añadir fila para este token
				card += `${ rankEmoji } <b>${ symbol }</b> - ${ name }\n`;
				card += `   💰 Price: <b>$${ this._formatNumber(price) }</b> ${ changeEmoji } ${ changeText }\n`;

				// Añadir market cap si está disponible
				if(marketCap > 0) {
					card += `   📊 MCap: <b>$${ this._formatNumber(marketCap, true) }</b>\n`;
				}

				// Añadir volumen si está disponible
				const volume = parseFloat(token.usdValueVolume24h || token.volume_24h || 0);
				if(volume > 0) {
					card += `   🔄 Vol 24h: <b>$${ this._formatNumber(volume, true) }</b>\n`;
				}

				// Añadir verificación si está disponible
				if(token.verified !== undefined) {
					card += token.verified ? '   ✅ Verified\n' : '';
				}

				// Separador entre tokens excepto el último
				if(index < topTokens.length - 1) {
					card += `\n`;
				}
			});

			// Información de paginación si hay
			if(page && tokensList.length >= 10) {
				card += `\n<i>Showing page ${ page }</i>`;
			}

			// Pie de página con fuente de datos
			card += `\n\n<i>Data from Vybe Network API • ${ this._formatDate(new Date()) }</i>`;

			return card;
		} catch(error) {
			this.logger.error('[_formatTopTokensInfo] Error formatting top tokens data', {
				err: error,
				errorMessage: error.message,
				stackTrace: error.stack,
			});
			return `<b>🏆 TOP TOKENS</b>\n\n<i>Error formatting token data: ${ error.message }</i>`;
		}
	}

	/**
	 * Specialized formatter for Solana Program Details
	 * Add this method to your TelegramBotService class
	 */
	_formatProgramDetailsInfo(programData) {
		try {
			if(!programData) {
				this.logger.warn('[_formatProgramDetailsInfo] Called with null or invalid data');
				return null;
			}

			this.logger.info('[_formatProgramDetailsInfo] Processing program details data', {
				dataPreview: JSON.stringify(programData).substring(0, 200) + '...',
			});

			// Extract program details from various possible locations
			const programId = programData.programId || programData.data?.programId;
			const details = programData.details || programData.data?.details;

			if(!programId || !details) {
				this.logger.warn('[_formatProgramDetailsInfo] No valid program details found in data');
				return '<b>📱 PROGRAM DETAILS</b>\n\n<i>No program information available</i>';
			}

			// Extract key details with fallbacks
			const name = details.friendlyName || details.name || 'Unknown Program';
			const entityName = details.entityName || '';
			const description = details.programDescription || details.description || '';
			const logoUrl = details.logoUrl || null;

			// Extract metrics
			const dau = parseInt(details.dau || 0);
			const txns1d = parseInt(details.transactions1d || 0);
			const instructions1d = parseInt(details.instructions1d || 0);
			const newUsers1d = parseInt(details.newUsersChange1d || 0);

			// Format the program ID (shortened)
			const shortProgramId = this._shortenAddress(programId);

			// Build the card
			let card = `<b>📱 PROGRAM DETAILS: ${ name }</b>\n\n`;

			// Basic info section
			card += `<b>ID:</b> <code>${ shortProgramId }</code>\n`;

			if(entityName) {
				card += `<b>Developer:</b> ${ entityName }\n`;
			}

			// Labels/categories if available
			if(details.labels && Array.isArray(details.labels) && details.labels.length > 0) {
				card += `<b>Category:</b> ${ details.labels.join(', ') }\n`;
			}

			// Add description if available
			if(description) {
				// Truncate description if too long
				const maxDescLength = 150;
				const truncatedDesc = description.length > maxDescLength ?
					description.substring(0, maxDescLength) + '...' :
					description;

				card += `\n<b>📝 DESCRIPTION</b>\n${ truncatedDesc }\n`;
			}

			// Metrics section with eye-catching formatting
			card += `\n<b>📊 METRICS (24h)</b>\n`;

			// DAU with visual indicator of size
			if(dau > 0) {
				let dauIndicator = '';
				if(dau > 500000) dauIndicator = '🔥 MASSIVE';
				else if(dau > 100000) dauIndicator = '🚀 LARGE';
				else if(dau > 10000) dauIndicator = '📈 GROWING';
				else dauIndicator = '👥 ACTIVE';

				card += `• Daily Users: <b>${ this._formatNumber(dau) }</b> ${ dauIndicator }\n`;
			}

			// Transactions
			if(txns1d > 0) {
				card += `• Transactions: <b>${ this._formatNumber(txns1d) }</b>\n`;
			}

			// Instructions
			if(instructions1d > 0) {
				card += `• Instructions: <b>${ this._formatNumber(instructions1d) }</b>\n`;
			}

			// New users with growth indicator
			if(newUsers1d !== 0) {
				const growthEmoji = newUsers1d > 0 ? '📈' : '📉';
				const growthSign = newUsers1d > 0 ? '+' : '';
				card += `• New Users: ${ growthEmoji } <b>${ growthSign }${ this._formatNumber(newUsers1d) }</b>\n`;
			}

			// Usage section for top programs
			if(dau > 50000 || txns1d > 1000000) {
				card += `\n<b>💡 INSIGHTS</b>\n`;

				if(name.toLowerCase().includes('jupiter')) {
					card += `• Jupiter is currently the leading DEX aggregator on Solana\n`;
					card += `• It routes trades through multiple AMMs for best prices\n`;
					card += `• Popular for both retail users and protocols\n`;
				} else if(details.labels && details.labels.includes('DEFI')) {
					card += `• This is a major DeFi protocol on Solana\n`;
					card += `• High daily activity indicates strong adoption\n`;
				} else {
					card += `• This program shows significant on-chain activity\n`;
					card += `• ${ dau > 100000 ? 'Very popular' : 'Growing' } with Solana users\n`;
				}
			}

			// Footer
			card += `\n<i>Data from Vybe Network API • ${ this._formatDate(new Date()) }</i>`;

			// Return the card and logo URL for possible display
			return {
				card: card,
				logoUrl: logoUrl,
			};
		} catch(error) {
			this.logger.error('[_formatProgramDetailsInfo] Error formatting program details', {
				err: error,
				errorMessage: error.message,
				stackTrace: error.stack,
			});
			return `<b>📱 PROGRAM DETAILS</b>\n\n<i>Error formatting program data: ${ error.message }</i>`;
		}
	}

	/**
	 * Specialized formatter for Program Active Users data
	 * Add this method to your TelegramBotService class
	 */
	_formatProgramActiveUsersInfo(userData) {
		try {
			if(!userData) {
				this.logger.warn('[_formatProgramActiveUsersInfo] Called with null or invalid data');
				return null;
			}

			this.logger.info('[_formatProgramActiveUsersInfo] Processing program active users data', {
				dataPreview: JSON.stringify(userData).substring(0, 200) + '...',
			});

			// Extract program details from various possible locations
			const programId = userData.programId || userData.data?.programId;
			const activeUsers = userData.activeUsers?.data ||
				userData.data?.activeUsers?.data ||
				[];

			const days = userData.days || userData.data?.days || 7;
			const limit = userData.limit || userData.data?.limit || activeUsers.length;

			if(!programId || !activeUsers || activeUsers.length === 0) {
				this.logger.warn('[_formatProgramActiveUsersInfo] No valid active users data found');
				return `<b>👥 PROGRAM ACTIVE USERS</b>\n\n<i>No active users data available for program ${ programId || '' }</i>`;
			}

			// Format the program ID (shortened)
			const shortProgramId = this._shortenAddress(programId);

			// Calculate total transactions
			const totalTxns = activeUsers.reduce((sum, user) => sum + (user.transactions || 0), 0);

			// Build the card
			let card = `<b>👥 PROGRAM ACTIVE USERS (${ days }d)</b>\n\n`;

			// Basic info section
			card += `<b>Program ID:</b> <code>${ shortProgramId }</code>\n`;
			card += `<b>Top Users:</b> ${ activeUsers.length }/${ limit }\n`;
			card += `<b>Total Transactions:</b> ${ this._formatNumber(totalTxns) }\n\n`;

			// Users table with ranked formatting
			card += `<b>🏆 TOP ACTIVE USERS BY TX COUNT</b>\n`;

			activeUsers.slice(0, 10).forEach((user, index) => {
				const wallet = user.wallet || 'Unknown';
				const shortWallet = this._shortenAddress(wallet);
				const txns = user.transactions || 0;

				// Rank emoji based on position
				const rankEmoji = index === 0 ? '🥇' : (index === 1 ? '🥈' : (index === 2 ? '🥉' : `${ index + 1 }.`));

				// Activity level emoji based on transaction count
				let activityEmoji = '🔄';
				if(txns > 250000) activityEmoji = '🔥'; // Super high activity
				else if(txns > 100000) activityEmoji = '⚡'; // Very high activity
				else if(txns > 50000) activityEmoji = '💪'; // High activity

				card += `${ rankEmoji } <code>${ shortWallet }</code>\n`;
				card += `   ${ activityEmoji } Transactions: <b>${ this._formatNumber(txns) }</b>\n`;

				// Add instruction count if different from txns
				if(user.instructions && user.instructions !== txns) {
					card += `   📊 Instructions: <b>${ this._formatNumber(user.instructions) }</b>\n`;
				}

				// Add divider except for last item
				if(index < Math.min(activeUsers.length, 10) - 1) {
					card += '\n';
				}
			});

			// Add note if more users exist beyond the 10 shown
			if(activeUsers.length > 10) {
				card += `\n\n<i>+ ${ activeUsers.length - 10 } more active users not shown</i>`;
			}

			// Add insights section
			card += `\n\n<b>💡 INSIGHTS</b>\n`;

			// Calculate concentration metrics
			const top3Txns = activeUsers.slice(0, 3).reduce((sum, user) => sum + (user.transactions || 0), 0);
			const top3Percent = totalTxns > 0 ? ((top3Txns / totalTxns) * 100).toFixed(1) : 0;

			// Generate insights based on the data
			card += `• Top 3 users account for <b>${ top3Percent }%</b> of all transactions\n`;

			if(top3Percent > 50) {
				card += `• Activity is highly concentrated among top users\n`;
			} else if(top3Percent < 20) {
				card += `• Activity is well distributed across many users\n`;
			}

			// Add specific insights for Jupiter if applicable
			if(programId === 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4') {
				card += `• These are likely trading bots or integrators using Jupiter API\n`;
			}

			// Footer
			card += `\n<i>Data from Vybe Network API • ${ this._formatDate(new Date()) }</i>`;

			return card;
		} catch(error) {
			this.logger.error('[_formatProgramActiveUsersInfo] Error formatting program users data', {
				err: error,
				errorMessage: error.message,
				stackTrace: error.stack,
			});
			return `<b>👥 PROGRAM ACTIVE USERS</b>\n\n<i>Error formatting user data: ${ error.message }</i>`;
		}
	}

	/**
	 * Specialized formatter for Program Ranking data
	 * Add this method to your TelegramBotService class
	 */
	_formatProgramRankingInfo(rankingData) {
		try {
			if(!rankingData) {
				this.logger.warn('[_formatProgramRankingInfo] Called with null or invalid data');
				return null;
			}

			this.logger.info('[_formatProgramRankingInfo] Processing program ranking data', {
				dataPreview: JSON.stringify(rankingData).substring(0, 200) + '...',
			});

			// Extract ranking details from various possible locations
			const ranking = rankingData.ranking || rankingData.data?.ranking;
			if(!ranking || !ranking.data || !Array.isArray(ranking.data)) {
				this.logger.warn('[_formatProgramRankingInfo] No valid ranking data found');
				return '<b>🏆 TOP SOLANA PROGRAMS</b>\n\n<i>No ranking data available</i>';
			}

			const rankedPrograms = ranking.data;
			const interval = ranking.interval || '1d';
			const page = rankingData.page || rankingData.data?.page || 1;
			const limit = rankingData.limit || rankingData.data?.limit || rankedPrograms.length;
			const date = ranking.date ? new Date(ranking.date * 1000) : new Date();

			// Build the formatted card
			let card = `<b>🏆 TOP SOLANA PROGRAMS (${ interval })</b>\n\n`;

			// Date info
			const dateStr = date.toLocaleDateString('en-US', {
				month: 'short',
				day: 'numeric',
				year: 'numeric',
			});

			card += `<i>Ranking as of ${ dateStr }</i>\n\n`;

			// Table of ranked programs
			rankedPrograms.forEach((program) => {
				const rank = program.programRank;
				const name = program.programName || 'Unknown Program';
				const programId = program.programId;
				const shortProgramId = this._shortenAddress(programId);
				const score = program.score * 100; // Convert to percentage

				// Format rank with emoji for top positions
				let rankDisplay = '';
				if(rank === 1) rankDisplay = '🥇 ';
				else if(rank === 2) rankDisplay = '🥈 ';
				else if(rank === 3) rankDisplay = '🥉 ';
				else rankDisplay = `${ rank }. `;

				// Format program name with highlighting for top ranked
				let nameStyle = '';
				if(rank <= 3) nameStyle = '<b>';

				// Build the program entry
				card += `${ rankDisplay }${ nameStyle }${ name }${ rank <= 3 ? '</b>' : '' }\n`;
				card += `   <code>${ shortProgramId }</code>\n`;

				// Show score with visual indicator
				// Use a different approach for score visualization
				const scoreFormatted = score.toFixed(1) + '%';
				// Create visual bar based on score percentage (assuming score is 0-100)
				const scoreBarLength = Math.round(score / 10); // 10% per character
				const scoreBar = '█'.repeat(scoreBarLength) + '▒'.repeat(10 - scoreBarLength);

				card += `   Score: <b>${ scoreFormatted }</b> ${ scoreBar }\n`;

				// Add separator between programs except last one
				if(rankedPrograms.indexOf(program) < rankedPrograms.length - 1) {
					card += '\n';
				}
			});

			// Add pagination info if applicable
			if(page > 1 || rankedPrograms.length >= limit) {
				card += `\n<i>Page ${ page } • ${ rankedPrograms.length } programs shown</i>`;
			}

			// Add insights section
			card += `\n\n<b>💡 INSIGHTS</b>\n`;

			// Add different insights based on the interval
			if(interval === '1d') {
				card += '• Rankings show most active programs in last 24 hours\n';
				card += '• DeFi protocols dominate the daily rankings\n';
			} else if(interval === '7d') {
				card += '• Weekly rankings show consistent program popularity\n';
				card += '• Consider these for stable protocol usage\n';
			} else if(interval === '30d') {
				card += '• Monthly rankings represent established protocols\n';
				card += '• These have demonstrated long-term reliability\n';
			}

			// Add explanation of the scoring method
			card += '• Score combines transactions, users and activity metrics\n';

			// Footer
			card += `\n<i>Data from Vybe Network API • ${ this._formatDate(new Date()) }</i>`;

			return card;
		} catch(error) {
			this.logger.error('[_formatProgramRankingInfo] Error formatting program ranking data', {
				err: error,
				errorMessage: error.message,
				stackTrace: error.stack,
			});
			return `<b>🏆 TOP SOLANA PROGRAMS</b>\n\n<i>Error formatting ranking data: ${ error.message }</i>`;
		}
	}

	/**
	 * Specialized formatter for Token Recommendations data
	 * Add this method to your TelegramBotService class
	 */
	_formatTokenRecommendationsInfo(recommendationsData) {
		try {
			if(!recommendationsData) {
				this.logger.warn('[_formatTokenRecommendationsInfo] Called with null or invalid data');
				return null;
			}

			this.logger.info('[_formatTokenRecommendationsInfo] Processing token recommendations data', {
				dataPreview: JSON.stringify(recommendationsData).substring(0, 200) + '...',
			});

			// Extract recommendations from various possible locations
			let recommendations = null;

			if(recommendationsData.recommendations && Array.isArray(recommendationsData.recommendations)) {
				recommendations = recommendationsData.recommendations;
			} else if(recommendationsData.data?.recommendations && Array.isArray(recommendationsData.data.recommendations)) {
				recommendations = recommendationsData.data.recommendations;
			}

			if(!recommendations || recommendations.length === 0) {
				this.logger.warn('[_formatTokenRecommendationsInfo] No valid recommendations data found');
				return '<b>🔥 RECOMMENDED TOKENS</b>\n\n<i>No token recommendations available</i>';
			}

			// Extract metadata
			const criteria = recommendationsData.criteria ||
				recommendationsData.data?.criteria ||
				'trending';

			const riskLevel = recommendationsData.risk_level ||
				recommendationsData.data?.risk_level ||
				'medium';

			const timeframe = recommendationsData.timeframe ||
				recommendationsData.data?.timeframe ||
				'short';

			// Build the card
			let card = `<b>🔥 RECOMMENDED ${ criteria.toUpperCase() } TOKENS</b>\n\n`;

			// Add risk and timeframe information
			card += `<i>Risk Level: <b>${ riskLevel }</b> • Timeframe: <b>${ timeframe }</b></i>\n\n`;

			// Build the recommendations table
			recommendations.forEach((token, index) => {
				const symbol = token.symbol || 'Unknown';
				const name = token.name || symbol;
				const price = parseFloat(token.price_usd || 0);
				const priceChange = parseFloat(token.price_change_1d || token.price_change_24h || 0);
				const volume = parseFloat(token.volume_24h || 0);
				const marketCap = parseFloat(token.marketCap || 0);

				// Format index with emoji for top positions
				let indexPrefix = '';
				if(index === 0) indexPrefix = '🥇 ';
				else if(index === 1) indexPrefix = '🥈 ';
				else if(index === 2) indexPrefix = '🥉 ';
				else indexPrefix = `${ index + 1 }. `;

				// Format price change with emoji
				const changeEmoji = priceChange > 0 ? '📈' : (priceChange < 0 ? '📉' : '➡️');
				const changeSign = priceChange >= 0 ? '+' : '';
				const changeText = `${ changeSign }${ priceChange.toFixed(2) }%`;

				// Add token information
				card += `${ indexPrefix }<b>${ name }</b> (<code>${ symbol }</code>)\n`;
				card += `   💰 Price: <b>$${ this._formatNumber(price) }</b>`;

				// Add price change if available
				if(priceChange !== 0) {
					card += ` ${ changeEmoji } <b>${ changeText }</b>`;
				}
				card += '\n';

				// Add market cap if available
				if(marketCap > 0) {
					card += `   📊 MCap: <b>$${ this._formatNumber(marketCap, true) }</b>\n`;
				}

				// Add volume if available
				if(volume > 0) {
					card += `   🔄 Vol: <b>$${ this._formatNumber(volume, true) }</b>\n`;
				}

				// Add token address (shortened)
				if(token.address) {
					const shortAddress = this._shortenAddress(token.address);
					card += `   <code>${ shortAddress }</code>\n`;
				}

				// Add reason for recommendation if available
				if(token.reason) {
					const shortReason = token.reason.length > 80 ?
						token.reason.substring(0, 77) + '...' :
						token.reason;
					card += `   <i>${ shortReason }</i>\n`;
				}

				// Add separator between tokens
				if(index < recommendations.length - 1) {
					card += '\n';
				}
			});

			// Add source information if available
			const source = recommendationsData.source || recommendationsData.data?.source;
			if(source) {
				card += `\n<i>Source: ${ source.api || 'Vybe Network' } • ${ this._formatDate(new Date()) }</i>`;
			} else {
				card += `\n<i>Data from Vybe Network API • ${ this._formatDate(new Date()) }</i>`;
			}

			return card;
		} catch(error) {
			this.logger.error('[_formatTokenRecommendationsInfo] Error formatting token recommendations', {
				err: error,
				errorMessage: error.message,
				stackTrace: error.stack,
			});
			return `<b>🔥 RECOMMENDED TOKENS</b>\n\n<i>Error formatting recommendations: ${ error.message }</i>`;
		}
	}

	/**
	 * Specialized formatter for Token Price Prediction data
	 * Add this method to your TelegramBotService class
	 */
	_formatPricePredictionInfo(predictionData) {
		try {
			if(!predictionData) {
				this.logger.warn('[_formatPricePredictionInfo] Called with null or invalid data');
				return null;
			}

			this.logger.info('[_formatPricePredictionInfo] Processing price prediction data', {
				dataPreview: JSON.stringify(predictionData).substring(0, 200) + '...',
			});

			// Extract prediction details from various possible locations
			const data = predictionData.data || predictionData;

			if(!data || !data.tokenSymbol || !data.prediction) {
				this.logger.warn('[_formatPricePredictionInfo] No valid prediction data found');
				return '<b>🔮 PRICE PREDICTION</b>\n\n<i>No valid prediction data available</i>';
			}

			// Extract token information
			const tokenSymbol = data.tokenSymbol;
			const tokenName = data.tokenName || tokenSymbol;
			const tokenAddress = data.token || '';

			// Extract price data
			const currentPrice = parseFloat(data.currentPrice || 0);
			const timeframe = data.timeframe || '24h';

			// Extract prediction details
			const prediction = data.prediction;
			const predictedPrice = parseFloat(prediction.predictedPrice || 0);
			const rangeLow = parseFloat(prediction.rangeLow || 0);
			const rangeHigh = parseFloat(prediction.rangeHigh || 0);
			const percentChange = parseFloat(prediction.percentChange || 0);
			const confidence = prediction.confidence || 'medium';
			const trend = prediction.trend || 'stable';

			// Build the prediction card
			let card = `<b>🔮 PRICE PREDICTION: ${ tokenSymbol }</b>\n\n`;

			// Token information section
			card += `<b>Token:</b> ${ tokenName } (<code>${ tokenSymbol }</code>)\n`;
			if(tokenAddress) {
				card += `<b>Address:</b> <code>${ this._shortenAddress(tokenAddress) }</code>\n`;
			}
			card += `<b>Timeframe:</b> ${ timeframe }\n\n`;

			// Current price and prediction section
			card += `<b>📈 PREDICTION DATA</b>\n`;
			card += `• Current Price: <b>$${ this._formatNumber(currentPrice) }</b>\n`;

			// Add predicted price with trend indicator
			let trendEmoji = '➡️';
			if(trend === 'up' || percentChange > 0) trendEmoji = '📈';
			else if(trend === 'down' || percentChange < 0) trendEmoji = '📉';
			else if(trend === 'stable') trendEmoji = '➡️';
			else if(trend === 'volatile') trendEmoji = '🔄';

			// Format percent change with sign
			const changeSign = percentChange >= 0 ? '+' : '';
			const changeText = percentChange !== 0 ? ` (${ changeSign }${ percentChange.toFixed(2) }%)` : '';

			card += `• Predicted Price: ${ trendEmoji } <b>$${ this._formatNumber(predictedPrice) }</b>${ changeText }\n`;

			// Add price range if available
			if(rangeLow > 0 || rangeHigh > 0) {
				card += `• Possible Range: <b>$${ this._formatNumber(rangeLow) }</b> - <b>$${ this._formatNumber(rangeHigh) }</b>\n`;
			}

			// Confidence level
			let confidenceEmoji = '⭐';
			if(confidence === 'high') confidenceEmoji = '⭐⭐⭐';
			else if(confidence === 'medium') confidenceEmoji = '⭐⭐';
			else if(confidence === 'low') confidenceEmoji = '⭐';

			card += `• Confidence: ${ confidenceEmoji } <b>${ confidence.toUpperCase() }</b>\n`;

			// Visual trend indicator (only if we have a meaningful prediction)
			if(currentPrice > 0 && predictedPrice > 0 && currentPrice !== predictedPrice) {
				card += `\n<b>📊 TREND VISUALIZATION</b>\n`;

				// Determine if going up or down
				const isUp = predictedPrice > currentPrice;

				// Create a simple ASCII trend line
				if(isUp) {
					card += `$${ this._formatNumber(currentPrice) } ➝➝➝➝➝ $${ this._formatNumber(predictedPrice) } 📈\n`;
				} else {
					card += `$${ this._formatNumber(currentPrice) } ➝➝➝➝➝ $${ this._formatNumber(predictedPrice) } 📉\n`;
				}
			}

			// Add disclaimer
			card += `\n<b>⚠️ DISCLAIMER</b>\n`;
			if(data.disclaimer) {
				// Truncate if too long
				const maxLength = 150;
				const disclaimer = data.disclaimer.length > maxLength ?
					data.disclaimer.substring(0, maxLength) + '...' :
					data.disclaimer;

				card += `<i>${ disclaimer }</i>\n`;
			} else {
				card += `<i>Price predictions are based on historical data and do not guarantee future performance. Not financial advice.</i>\n`;
			}

			// Footer
			card += `\n<i>Data from Vybe Network API • ${ this._formatDate(new Date()) }</i>`;

			return card;
		} catch(error) {
			this.logger.error('[_formatPricePredictionInfo] Error formatting price prediction', {
				err: error,
				errorMessage: error.message,
				stackTrace: error.stack,
			});
			return `<b>🔮 PRICE PREDICTION</b>\n\n<i>Error formatting prediction data: ${ error.message }</i>`;
		}
	}
}

export default TelegramBotService;
