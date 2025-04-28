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
				this.logger.debug('Processing update', {
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
	async _processTextMessage(ctx) {
		const messageText = ctx.message?.text?.trim();
		if(!messageText) {
			this.logger.warn('Received message without text content', { update_id: ctx.update.update_id });
			return;
		}

		// Ignore commands handled elsewhere
		if(messageText.startsWith('/')) {
			this.logger.debug('Ignoring command in text handler', { text: messageText });
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

			this.logger.debug('Sending message to ConversationService', {
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
					// Enviar JSON formateado en un bloque de código distintivo
					await ctx.reply(
						`⚙️ DEBUG JSON RESPONSE ⚙️\n\n<pre><code class="language-json">${ JSON.stringify(response, null, 2) }</code></pre>`,
						{
							parse_mode: 'HTML',
							disable_web_page_preview: true,
						},
					);

					// También registra en logs que se envió el JSON
					this.logger.debug('Successfully sent full JSON response for debugging');
				} catch(error) {
					this.logger.error('Error sending full JSON debug response', { err: error });

					// Intenta un método alternativo si falla
					try {
						// Enviar en múltiples mensajes si es necesario
						const jsonStr = JSON.stringify(response, null, 2);
						await ctx.reply('⚙️ DEBUG JSON (parte 1) ⚙️\n```\n' + jsonStr.substring(0, 3000) + '\n```',
							{ parse_mode: 'Markdown' });

						if(jsonStr.length > 3000) {
							await ctx.reply('⚙️ DEBUG JSON (parte 2) ⚙️\n```\n' + jsonStr.substring(3000) + '\n```',
								{ parse_mode: 'Markdown' });
						}
					} catch(e) {
						this.logger.error('Failed to send JSON even with alternative method', { err: e });
					}
				}
			}

			// Format and send response
			if(response?.assistantMessage?.text) {
				try {
					// Try enhanced formatting with visuals
					const formattedMessage = this.formatEnhancedResponse(response);
					const inlineKeyboard = this.createDynamicKeyboard(response.structuredData);

					await ctx.reply(formattedMessage, {
						parse_mode: 'HTML',
						...(inlineKeyboard && { reply_markup: inlineKeyboard }),
						disable_web_page_preview: true,
					});

					this.logger.info('Enhanced response sent successfully', {
						chatId: chat.id,
						userId: user.id,
						responseLength: formattedMessage.length,
					});
				} catch(formattingError) {
					this.logger.warn('Enhanced formatting failed, using fallback', { err: formattingError });

					// Fallback to basic formatting
					await this._sendFallbackResponse(ctx, response);
				}
			} else {
				this.logger.warn('No text in assistantMessage from ConversationService');
				await ctx.reply('I processed your request but had trouble generating a response. Please try again.');
			}
		} catch(error) {
			this._handleError(ctx, error, 'text_message_processing');
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
		const formattedResponse = this.formatEnhancedResponse(response);
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
	formatEnhancedResponse(response) {
		if(!response || !response.assistantMessage || !response.assistantMessage.text) {
			return 'I processed your request but encountered an issue with the response format.';
		}

		try {
			const MAX_MESSAGE_LENGTH = 4000; // Telegram limit is 4096, keep some buffer
			let message = '';

			// 1. Add main response text with enhanced formatting
			const enhancedText = this._enhanceTextFormatting(response.assistantMessage.text);
			message += enhancedText;

			// 2. If we have structured data, create visual elements based on that data
			if(response.structuredData && Object.keys(response.structuredData).length > 0) {
				// This is where we create the visual representation of the data
				const dataVisualization = this._createDataVisualization(response.structuredData);
				if(dataVisualization) {
					message += '\n\n' + dataVisualization;
				}

				// Add source attribution
				const sourceAttribution = this._createSourceAttribution(response.structuredData);
				if(sourceAttribution) {
					message += '\n\n' + sourceAttribution;
				}
			}

			// 3. Ensure we don't exceed Telegram limits
			if(message.length > MAX_MESSAGE_LENGTH) {
				const truncationMsg = '\n\n<i>⚠️ Message truncated due to length limits...</i>';
				message = message.substring(0, MAX_MESSAGE_LENGTH - truncationMsg.length) + truncationMsg;
			}

			return message;
		} catch(error) {
			this.logger.error('Error in formatEnhancedResponse', { err: error });
			// Return escaped original text as fallback
			return this._escapeHtml(response.assistantMessage.text);
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
	 * Create dynamic keyboard based on structured data
	 */
	createDynamicKeyboard(structuredData) {
		if(!structuredData) return null;

		try {
			const buttons = [];
			const MAX_CALLBACK_DATA_LENGTH = 64; // Telegram limit

			// For token recommendations
			if(structuredData.recommendations && Array.isArray(structuredData.recommendations)) {
				const tokens = structuredData.recommendations.slice(0, 3); // Top 3

				// ROW 1: View token details
				const viewButtons = tokens.map(token => {
					const symbol = token.symbol || 'UNKNOWN';
					return Markup.button.callback(`📊 ${ symbol }`, `token:info:${ symbol }`);
				}).filter(Boolean);

				if(viewButtons.length > 0) {
					buttons.push(viewButtons);
				}

				// ROW 2: Set price alerts
				const alertButtons = tokens.map(token => {
					const symbol = token.symbol || 'UNKNOWN';
					return Markup.button.callback(`🔔 Alert ${ symbol }`, `alert:set:${ symbol }`);
				}).filter(Boolean);

				if(alertButtons.length > 0) {
					buttons.push(alertButtons);
				}

				// ROW 3: Actions
				if(tokens.length >= 2) {
					const actions = [];

					// Compare top 2
					const compareAction = `action:compare:${ tokens[0].symbol }:${ tokens[1].symbol }`;
					if(compareAction.length <= MAX_CALLBACK_DATA_LENGTH) {
						actions.push(Markup.button.callback('📈 Compare Top 2', compareAction));
					}

					// More recommendations
					actions.push(Markup.button.callback('🔄 More Tokens', 'action:more_recommendations'));

					if(actions.length > 0) {
						buttons.push(actions);
					}
				}

				// ROW 4: View on explorer (if address available)
				const topToken = tokens[0];
				if(topToken && topToken.address) {
					const explorerUrl = `https://solscan.io/token/${ topToken.address }`;
					buttons.push([
						Markup.button.url('🔍 View on Explorer', explorerUrl),
					]);
				}
			}

			// For single token
			else if(structuredData.token) {
				const token = structuredData.token;
				const symbol = token.symbol || 'TOKEN';
				const address = token.address || token.mintAddress;

				// ROW 1: Analysis actions
				buttons.push([
					Markup.button.callback('📊 Price History', `token:chart:${ symbol }`),
					Markup.button.callback('👥 Holders', `token:holders:${ symbol }`),
				]);

				// ROW 2: Trading actions
				buttons.push([
					Markup.button.callback('🔔 Set Alert', `alert:set:${ symbol }`),
					Markup.button.callback('🔮 Price Prediction', `token:predict:${ symbol }`),
				]);

				// ROW 3: External link if address available
				if(address) {
					const explorerUrl = `https://solscan.io/token/${ address }`;
					buttons.push([
						Markup.button.url('🔍 View on Explorer', explorerUrl),
					]);
				}
			}

			// For wallet data
			else if(structuredData.wallet) {
				const walletAddr = structuredData.wallet;

				// ROW 1: Analysis actions
				buttons.push([
					Markup.button.callback('💰 Token Holdings', `wallet:tokens:${ walletAddr }`),
					Markup.button.callback('📊 PnL Analysis', `wallet:pnl:${ walletAddr }`),
				]);

				// ROW 2: Activity
				buttons.push([
					Markup.button.callback('📝 Recent Activity', `wallet:activity:${ walletAddr }`),
					Markup.button.callback('🔍 Risk Analysis', `wallet:risk:${ walletAddr }`),
				]);

				// ROW 3: External link
				const explorerUrl = `https://solscan.io/account/${ walletAddr }`;
				buttons.push([
					Markup.button.url('🌐 View on Explorer', explorerUrl),
				]);
			}

			// Always add some general action buttons if no special data is present
			if(buttons.length === 0) {
				buttons.push([
					Markup.button.callback('🔍 Top Tokens', 'action:explore_top_tokens'),
					Markup.button.callback('📈 Market Overview', 'action:market_overview'),
				]);
			}

			return buttons.length > 0 ? Markup.inlineKeyboard(buttons) : null;
		} catch(error) {
			this.logger.error('Error creating dynamic keyboard', { err: error });
			return null;
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
	 * Create visual element based on data type
	 */
	_createVisualElement(data) {
		if(!data) return null;

		try {
			// Token price dashboard
			if(data.token && data.token.price_usd) {
				return this._createTokenDashboard(data.token);
			}

			// Token recommendations comparison
			else if(data.recommendations && Array.isArray(data.recommendations) && data.recommendations.length > 0) {
				return this._createTokenComparison(data.recommendations);
			}

			// Wallet portfolio
			else if(data.wallet && data.tokens) {
				return this._createWalletPortfolio(data);
			}

			// Price prediction
			else if(data.prediction && data.tokenSymbol) {
				return this._createPricePrediction(data);
			}

			// No special visual element for this data type
			return null;
		} catch(error) {
			this.logger.warn('Error creating visual element', { err: error });
			return null; // Return null on any error
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
	 * Create data highlights section
	 */
	_createDataHighlights(data) {
		if(!data) return null;

		try {
			// Extract key metrics based on data type
			const metrics = [];

			// For token data
			if(data.token) {
				const t = data.token;

				if(t.price_usd || t.price) {
					metrics.push({
						label: 'Price',
						value: `${ this._formatNumber(t.price_usd || t.price) }`,
						emoji: '💲',
					});
				}

				if(t.price_change_1d != null) {
					const change = t.price_change_1d;
					metrics.push({
						label: '24h Change',
						value: `${ change >= 0 ? '+' : '' }${ change.toFixed(2) }%`,
						emoji: change >= 0 ? '📈' : '📉',
						color: change >= 0 ? 'green' : 'red',
					});
				}

				if(t.marketCap) {
					metrics.push({
						label: 'Market Cap',
						value: `${ this._formatNumber(t.marketCap, true) }`,
						emoji: '🏦',
					});
				}

				if(t.volume_24h) {
					metrics.push({
						label: 'Volume 24h',
						value: `${ this._formatNumber(t.volume_24h, true) }`,
						emoji: '📊',
					});
				}
			}

			// For wallet data
			else if(data.wallet && data.tokens) {
				if(data.tokens.totalTokenValueUsd) {
					metrics.push({
						label: 'Portfolio Value',
						value: `${ this._formatNumber(data.tokens.totalTokenValueUsd) }`,
						emoji: '💼',
					});
				}

				if(data.tokens.totalTokenCount) {
					metrics.push({
						label: 'Token Count',
						value: data.tokens.totalTokenCount,
						emoji: '🪙',
					});
				}

				if(data.tokens.totalTokenValueUsd1dChange != null) {
					const change = data.tokens.totalTokenValueUsd1dChange;
					metrics.push({
						label: '24h Change',
						value: `${ change >= 0 ? '+' : '' }${ this._formatNumber(change) }`,
						emoji: change >= 0 ? '📈' : '📉',
						color: change >= 0 ? 'green' : 'red',
					});
				}
			}

			// For recommendations
			else if(data.recommendations && Array.isArray(data.recommendations) && data.recommendations.length > 0) {
				metrics.push({
					label: 'Recommendations',
					value: `${ data.recommendations.length } tokens`,
					emoji: '✨',
				});

				if(data.recommendations[0]?.symbol) {
					metrics.push({
						label: 'Top Pick',
						value: data.recommendations[0].symbol,
						emoji: '🥇',
					});
				}

				if(data.criteria) {
					metrics.push({
						label: 'Criteria',
						value: data.criteria,
						emoji: '🎯',
					});
				}

				if(data.risk_level) {
					metrics.push({
						label: 'Risk Level',
						value: data.risk_level,
						emoji: '⚖️',
					});
				}
			}

			// For price alerts
			else if(data.alert_created === true && data.token_symbol) {
				metrics.push({
					label: 'Alert Set',
					value: `${ data.token_symbol } ${ data.condition_type.replace('price_', '') } ${ this._formatNumber(data.threshold_value) }`,
					emoji: '🔔',
				});
			}

			// If no metrics found, return null
			if(metrics.length === 0) return null;

			// Create highlight banner
			let banner = '<pre>┌─────────── KEY HIGHLIGHTS ───────────┐\n';

			for(const metric of metrics.slice(0, 4)) { // Limit to 4 metrics
				const value = metric.value.toString();
				const colorTag = metric.color ? `<span style="color:${ metric.color }">` : '';
				const colorCloseTag = metric.color ? '</span>' : '';

				banner += `│ ${ metric.emoji } <b>${ metric.label }</b>: ${ colorTag }${ value }${ colorCloseTag }`;

				// Pad with spaces to align
				const contentLength = metric.label.length + value.toString().length + 4; // +4 for emoji and ": "
				const padding = Math.max(0, 38 - contentLength);
				banner += ' '.repeat(padding) + '│\n';
			}

			banner += '└───────────────────────────────────────┘</pre>';

			return banner;
		} catch(error) {
			this.logger.warn('Error creating data highlights', { err: error });
			return null;
		}
	}

	/**
	 * Create source attribution
	 */
	// Add this method for source attribution:
	_createSourceAttribution(structuredData) {
		try {
			let source = null;

			// Find source info
			if(structuredData.source) {
				source = structuredData.source;
			} else if(structuredData.recommendations &&
				structuredData.recommendations[0] &&
				structuredData.recommendations[0].source) {
				source = structuredData.recommendations[0].source;
			}

			if(!source) return null;

			// Create attribution
			let attribution = `<i>Data Source: <b>${ this._escapeHtml(source.api || 'Vybe Network') }</b>`;

			if(source.endpoint) {
				attribution += ` | ${ this._escapeHtml(source.endpoint) }`;
			}

			if(source.timestamp) {
				const timestamp = new Date(source.timestamp);
				const timeString = timestamp.toLocaleTimeString();
				attribution += ` | ${ timeString }`;
			} else {
				attribution += ` | ${ new Date().toLocaleTimeString() }`;
			}

			attribution += '</i>';

			return attribution;
		} catch(error) {
			this.logger.warn('Error creating source attribution', { err: error });
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

		this.logger.debug('Getting or creating user context...', {
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
				this.logger.debug('Existing session found', { sessionId: session.id, userId: user.id });

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
					this.logger.debug('Using existing active chat', { chatId: chat.id });
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

			this.logger.debug('User context ready', {
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
				await this._editOrSendNewMessage(ctx, response, processingMessage.message_id);
			} else {
				// Send as new message if no processing message
				const formattedResponse = this.formatEnhancedResponse(response);
				const inlineKeyboard = this.createDynamicKeyboard(response.structuredData);

				await ctx.reply(formattedResponse, {
					parse_mode: 'HTML',
					...(inlineKeyboard && { reply_markup: inlineKeyboard }),
					disable_web_page_preview: true,
				});
			}
		} catch(error) {
			this._handleError(ctx, error, 'callback_query_processing');
		}
	}

}

export default TelegramBotService;
