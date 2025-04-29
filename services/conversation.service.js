// conversation.service.js
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import AIService from './ai.service.js';
import VybeService from './vybe.service.js';
import ChromaService from './chroma.service.js';
import { createLogger } from '#utils/logger.js';
import { OpenAIEmbeddingFunction } from 'chromadb';

/**
 * Service to handle AI conversations and related actions
 */
class ConversationService {
	static TOKEN_COLLECTION_NAME = 'token_resolution';
	// Asegúrate que este modelo coincida con el usado para crear los embeddings en la colección
	static TOKEN_EMBEDDING_MODEL = 'text-embedding-3-small';

	constructor() {
		// Reemplazar tu logger actual con EfficientLogger
		this.logger = createLogger({
			name: 'ConversationService',
			level: 'debug',
			files: true,  // Asegúrate de que esto esté activado para guardar en archivos
			console: true, // Mantén la salida de consola también por ahora
		});

		// El resto de tu constructor sigue igual
		this.prisma = new PrismaClient();
		this.defaultModel = process.env.DEFAULT_AI_MODEL || 'gpt-4.1-nano';
		this.availableActions = this.loadAvailableActions();
		this.memoryContextSize = 6;

		this.logger.info('Initialized with:', {
			defaultModel: this.defaultModel,
			memoryContextSize: this.memoryContextSize,
			actionsLoaded: !!this.availableActions?.actions?.length,
		});
	}

	/**
	 * Loads available actions for the AI
	 * @returns {Object} Object with available actions
	 */
	loadAvailableActions() {
		this.logger.entry('loadAvailableActions');
		try {
			// In a real environment, this could be loaded from a file or DB
			const actions = {
				actions: [
					{
						name: 'create_price_alert',
						description: 'Sets up a notification for when a specific cryptocurrency token\'s price goes above or below a certain value in a given currency (default USD). Use this *only* when the user explicitly asks to set a price alert or monitor a specific price target.',
						parameters: {
							type: 'object',
							properties: {
								token_symbol: {
									type: 'string',
									description: 'The trading symbol of the cryptocurrency (e.g., \'SOL\', \'BTC\', \'ETH\', \'JUP\', \'BONK\'). Must be a valid symbol known by the Vybe API.',
								},
								condition_type: {
									type: 'string',
									description: 'Whether to alert when the price is \'price_above\' or \'price_below\' the threshold.',
									enum: [ 'price_above', 'price_below' ],
								},
								threshold_value: {
									type: 'number',
									description: 'The target price value (positive number) to trigger the alert.',
								},
								currency: {
									type: 'string',
									description: 'The currency for the threshold value (e.g., \'USD\'). Defaults to \'USD\' if not specified.',
									default: 'USD',
								},
							},
							required: [ 'token_symbol', 'condition_type', 'threshold_value' ],
						},
						handlerFunction: 'actionCreatePriceAlert',
						category: 'Alerts',
						isActive: true,
					},
					{
						'name': 'fetch_token_data',
						// --- DESCRIPCIÓN MEJORADA ---
						'description': 'Get the current price and other details (market cap, volume, etc.) for ONE SPECIFIC Solana token identified by its mint address. Use this FIRST and ONLY when the user asks about the price, value, or general information of a SINGLE known token (e.g., \'price of SOL\', \'info on JUP\'). Requires the token\'s specific mint address.',
						// --- FIN DESCRIPCIÓN MEJORADA ---
						'parameters': {
							'type': 'object',
							'properties': {
								'token_address': {
									'type': 'string',
									'description': 'The unique mint address of the Solana token (e.g., "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" for USDC).',
								},
								'include_price': {
									'type': 'boolean',
									'description': 'Optional. Set to true to explicitly include the latest price data. Default: true.',
									'default': true,
								},
								'include_holders': {
									'type': 'boolean',
									'description': 'Optional. Set to true to include information about the top token holders. Default: false.',
									'default': false,
								},
							},
							'required': [ 'token_address' ],
						},
						'handlerFunction': 'actionFetchTokenData',
						'category': 'Token Info',
						'isActive': true,
					}, // testeado
					{
						name: 'fetch_token_price_history',
						description: 'Fetches historical Open-High-Low-Close (OHLC) price data for a specific Solana token, typically used for charting or analyzing past price movements over time.',
						parameters: {
							type: 'object',
							properties: {
								token_address: {
									type: 'string',
									description: 'The unique mint address of the Solana token.',
								},
								resolution: {
									type: 'string',
									description: 'The time interval for each OHLC candle. Check Vybe API docs for exact supported values. Common examples: "1m", "5m", "15m", "1h", "4h", "1d", "1w". Default: "1d".',
									enum: [ '1m', '5m', '15m', '1h', '4h', '1d', '1w' ], // Example enums, verify with Vybe Docs
									default: '1d',
								},
								time_start: {
									type: 'integer',
									description: 'Optional. The start time for the history as a Unix timestamp in seconds.',
								},
								time_end: {
									type: 'integer',
									description: 'Optional. The end time for the history as a Unix timestamp in seconds.',
								},
								limit: {
									type: 'integer',
									description: 'Optional. Maximum number of data points (candles) to return. Default depends on API (e.g., 100).',
								},
							},
							required: [ 'token_address' ],
						},
						handlerFunction: 'actionFetchTokenPriceHistory',
						category: 'Token Info',
						isActive: true,
					}, // testeado
					{
						name: 'fetch_token_holders_data',
						description: 'Retrieves a list of top holders for a specific Solana token, showing wallet addresses and their corresponding balances. Useful for understanding token distribution and identifying large holders (\'whales\').',
						parameters: {
							type: 'object',
							properties: {
								token_address: {
									type: 'string',
									description: 'The unique mint address of the Solana token.',
								},
								limit: {
									type: 'integer',
									description: 'Optional. Maximum number of top holders to return. Default: 10.',
									default: 10,
								},
								page: {
									type: 'integer',
									description: 'Optional. Page number for pagination if more results than the limit are available. Default: 1.',
									default: 1,
								},
							},
							required: [ 'token_address' ],
						},
						handlerFunction: 'actionFetchTokenHoldersData',
						category: 'Token Info',
						isActive: true,
					}, // testeado
					{
						name: 'fetch_wallet_data',
						description: 'Fetches a comprehensive overview of a specific Solana wallet address, optionally including its current SPL token balances and NFT holdings.',
						parameters: {
							type: 'object',
							properties: {
								wallet_address: {
									type: 'string',
									description: 'The public key (address) of the Solana wallet.',
								},
								include_tokens: {
									type: 'boolean',
									description: 'Optional. Set to true to include SPL token balances. Default: true.',
									default: true,
								},
								include_nfts: {
									type: 'boolean',
									description: 'Optional. Set to true to include NFT holdings. Default: true.',
									default: true,
								},
							},
							required: [ 'wallet_address' ],
						},
						handlerFunction: 'actionFetchWalletData',
						category: 'Wallet Info',
						isActive: true,
					}, // testeado
					{
						name: 'fetch_wallet_pnl',
						description: 'Calculates and retrieves the realized and unrealized Profit and Loss (PnL) performance analysis for a specific Solana wallet over a specified number of past days. Useful for understanding the wallet\'s investment performance.',
						parameters: {
							type: 'object',
							properties: {
								wallet_address: {
									type: 'string',
									description: 'The public key (address) of the Solana wallet.',
								},
								days: {
									type: 'integer',
									description: 'Optional. The number of past days to include in the PnL calculation (e.g., 7, 30, 90). Default uses the API\'s standard range (e.g., 30 days).',
								},
							},
							required: [ 'wallet_address' ],
						},
						handlerFunction: 'actionFetchWalletPnl',
						category: 'Wallet Info',
						isActive: true,
					}, // -----
					{
						name: 'fetch_token_transfers',
						description: 'Retrieves a list of historical transfer transactions for a specific SPL token. Allows filtering by sender/receiver wallet, transfer amount (in USD), and time range.',
						parameters: {
							type: 'object',
							properties: {
								token_address: {
									type: 'string',
									description: 'The unique mint address of the Solana token.',
								},
								wallet_address: {
									type: 'string',
									description: 'Optional. Filter transfers involving this specific wallet address (as either sender or receiver).',
								},
								min_usd_amount: {
									type: 'number',
									description: 'Optional. Filter for transfers with a minimum value in USD.',
								},
								max_usd_amount: {
									type: 'number',
									description: 'Optional. Filter for transfers with a maximum value in USD.',
								},
								time_start: {
									type: 'integer',
									description: 'Optional. Start time for filtering transfers, as a Unix timestamp in seconds.',
								},
								time_end: {
									type: 'integer',
									description: 'Optional. End time for filtering transfers, as a Unix timestamp in seconds.',
								},
								limit: {
									type: 'integer',
									description: 'Optional. Maximum number of transfers to return. Default: 20.',
									default: 20,
								},
								page: {
									type: 'integer',
									description: 'Optional. Page number for pagination. Default: 1.',
									default: 1,
								},
							},
							required: [ 'token_address' ],
						},
						handlerFunction: 'actionFetchTokenTransfers',
						category: 'Token Info',
						isActive: true,
					}, // -----
					{
						'name': 'fetch_top_tokens',
						// --- DESCRIPCIÓN MEJORADA ---
						'description': 'Retrieves a RANKED LIST of MULTIPLE Solana tokens based on market criteria (e.g., marketCap, volume_24h, price_change_24h). Use ONLY for discovering trending tokens, getting market rankings, or finding lists of tokens meeting certain criteria. DO NOT use this if the user asks about the price or details of only ONE specific token (use fetch_token_data for that instead).',
						// --- FIN DESCRIPCIÓN MEJORADA ---
						'parameters': {
							'type': 'object',
							'properties': {
								'sort_by': {
									'type': 'string',
									'description': 'The metric to sort the tokens by. Common values: "marketCap", "price_change_24h", "holders". See Vybe docs for all valid fields.',
									'enum': [ 'marketCap', 'price_change_24h', 'holders', 'volume_24h', 'price' ], // Enum más explícito
									'default': 'marketCap',
								},
								'order': {
									'type': 'string',
									'description': 'The sort order: "asc" (ascending) or "desc" (descending). Default: "desc".',
									'enum': [ 'asc', 'desc' ],
									'default': 'desc',
								},
								'limit': {
									'type': 'integer',
									'description': 'Optional. Maximum number of tokens to return. Default: 10.',
									'default': 10,
								},
								'page': {
									'type': 'integer',
									'description': 'Optional. Page number for pagination. Default: 1.',
									'default': 1,
								},
							},
							'required': [],
						},
						'handlerFunction': 'actionFetchTopTokens',
						'category': 'Market Info',
						'isActive': true,
					}, // testeado
					{
						name: 'fetch_program_details',
						description: 'Retrieves detailed information and basic metrics about a specific Solana program (smart contract) using its Program ID (address).',
						parameters: {
							type: 'object',
							properties: {
								program_id: {
									type: 'string',
									description: 'The unique public key (address) of the Solana program.',
								},
							},
							required: [ 'program_id' ],
						},
						handlerFunction: 'actionFetchProgramDetails',
						category: 'Program Info',
						isActive: true,
					}, // testeado
					{
						name: 'fetch_program_active_users',
						description: 'Gets a list of the most active user wallets interacting with a specific Solana program over a defined recent period (e.g., last 7 days).',
						parameters: {
							type: 'object',
							properties: {
								program_id: {
									type: 'string',
									description: 'The unique public key (address) of the Solana program.',
								},
								days: {
									type: 'integer',
									description: 'Optional. The number of past days to analyze for activity (e.g., 1, 7, 30). Check Vybe API for limits. Default: 7.',
									default: 7,
								},
								limit: {
									type: 'integer',
									description: 'Optional. Maximum number of active user wallets to return. Default: 20.',
									default: 20,
								},
							},
							required: [ 'program_id' ],
						},
						handlerFunction: 'actionFetchProgramActiveUsers',
						category: 'Program Info',
						isActive: true,
					}, // testeado
					{
						name: 'fetch_program_tvl',
						description: 'Retrieves the historical Total Value Locked (TVL) time series data for a specific Solana DeFi program, showing how much value is locked in the protocol over time.',
						parameters: {
							type: 'object',
							properties: {
								program_id: {
									type: 'string',
									description: 'The unique public key (address) of the Solana program.',
								},
								resolution: {
									type: 'string',
									description: 'The time resolution for the TVL data points (e.g., "1h", "1d", "1w", "1m", "1y"). Check Vybe API docs for supported values. Default: "1d".',
									enum: [ '1h', '1d', '1w', '1m', '1y' ], // Verify with Vybe Docs
									default: '1d',
								},
							},
							required: [ 'program_id' ],
						},
						handlerFunction: 'actionFetchProgramTvl',
						category: 'Program Info',
						isActive: true,
					}, // -----
					{
						name: 'fetch_program_ranking',
						description: 'Gets a ranked list of Solana programs based on certain metrics provided by the Vybe API (e.g., activity, TVL growth). Useful for discovering popular or significant programs.',
						parameters: {
							type: 'object',
							properties: {
								limit: {
									type: 'integer',
									description: 'Optional. Maximum number of programs to return in the ranking. Default: 20.',
									default: 20,
								},
								page: {
									type: 'integer',
									description: 'Optional. Page number for pagination. Default: 1.',
									default: 1,
								},
							},
							required: [],
						},
						handlerFunction: 'actionFetchProgramRanking',
						category: 'Program Info',
						isActive: true,
					}, // testeado
					{
						name: 'fetch_market_info',
						description: 'Retrieves information about a specific trading market (e.g., a SOL/USDC liquidity pool) on a Solana DEX or AMM, identified by its unique market ID (address).',
						parameters: {
							type: 'object',
							properties: {
								market_id: {
									type: 'string',
									description: 'The unique identifier (address) of the trading market or liquidity pool.',
								},
								program_id: {
									type: 'string',
									description: 'Optional. The Program ID of the specific DEX/AMM hosting the market (e.g., Raydium, Orca). Helps disambiguate if market IDs are reused.',
								},
							},
							required: [ 'market_id' ],
						},
						handlerFunction: 'actionFetchMarketInfo',
						category: 'Market Info',
						isActive: true,
					}, // -----
					{
						name: 'fetch_pair_ohlcv',
						description: 'Fetches historical Open-High-Low-Close-Volume (OHLCV) candle data for a specific trading pair (defined by base and quote token mint addresses) across Solana DEXs/AMMs.',
						parameters: {
							type: 'object',
							properties: {
								base_mint_address: {
									type: 'string',
									description: 'The mint address of the base token in the pair (e.g., SOL address for SOL/USDC).',
								},
								quote_mint_address: {
									type: 'string',
									description: 'The mint address of the quote token in the pair (e.g., USDC address for SOL/USDC).',
								},
								program_id: {
									type: 'string',
									description: 'Optional. Filter data from a specific DEX/AMM Program ID.',
								},
								resolution: {
									type: 'string',
									description: 'Time interval for each candle (e.g., "1m", "1h", "1d"). Check Vybe API docs. Default: "1d".',
									enum: [ '1m', '5m', '15m', '1h', '4h', '1d', '1w' ], // Example enums, verify
									default: '1d',
								},
								time_start: {
									type: 'integer',
									description: 'Optional. Start time as Unix timestamp (seconds).',
								},
								time_end: {
									type: 'integer',
									description: 'Optional. End time as Unix timestamp (seconds).',
								},
								limit: {
									type: 'integer',
									description: 'Optional. Maximum number of candles to return. Default: 100.',
									default: 100,
								},
							},
							required: [ 'base_mint_address', 'quote_mint_address' ],
						},
						handlerFunction: 'actionFetchPairOhlcv',
						category: 'Market Info',
						isActive: true,
					}, // -----
					{
						name: 'analyze_token_trend',
						description: 'Performs a trend analysis for a specific Solana token by fetching and summarizing historical data (like price, volume, or holders count) over a selected timeframe (day, week, month).',
						parameters: {
							type: 'object',
							properties: {
								token_address: {
									type: 'string',
									description: 'The unique mint address of the Solana token.',
								},
								timeframe: {
									type: 'string',
									description: 'The period over which to analyze the trend.',
									enum: [ 'day', 'week', 'month' ],
									default: 'week',
								},
								metrics: {
									type: 'string', // Could be array, but string allows comma-separated
									description: 'Optional. Comma-separated list of metrics to include in the analysis (e.g., "price,volume,holders"). Default: "price,volume".',
									default: 'price,volume',
								},
							},
							required: [ 'token_address' ],
						},
						handlerFunction: 'actionAnalyzeTokenTrend',
						category: 'Analysis',
						isActive: true,
					}, // fix Vybe call
					{
						name: 'recommend_tokens',
						description: 'Provides a list of recommended Solana tokens based on user-defined criteria such as market trends (trending), trading volume (volume), price growth (growth), risk level, and investment timeframe. **USE THIS ACTION when the user asks for investment ideas, recommendations, \'what should I invest in?\', or similar requests.**',
						parameters: {
							type: 'object',
							properties: {
								criteria: {
									type: 'string',
									description: 'Primary criteria for selecting tokens. Examples: "marketCap" (high value), "volume_24h" (high activity), "price_change_24h" (recent growth/loss), "holders" (distribution), "trending" (combines factors). Default: "marketCap".',
									enum: [ 'marketCap', 'volume_24h', 'price_change_24h', 'holders', 'trending', 'growth' ], // Add more specific criteria if needed
									default: 'marketCap',
								},
								risk_level: {
									type: 'string',
									description: 'Desired risk profile which influences filtering (e.g., low risk might filter for higher market cap or lower volatility).',
									enum: [ 'low', 'medium', 'high' ],
									default: 'medium',
								},
								timeframe: {
									type: 'string',
									description: 'Investment timeframe which can influence sorting (e.g., short-term might prioritize recent price change).',
									enum: [ 'short', 'medium', 'long' ],
									default: 'medium',
								},
								limit: {
									type: 'integer',
									description: 'Optional. Maximum number of token recommendations to return. Default: 5.',
									default: 5,
								},
							},
							required: [], // Criteria, risk, timeframe have defaults
						},
						handlerFunction: 'actionRecommendTokens',
						category: 'Recommendations',
						isActive: true,
					}, // testeado
					{
						name: 'schedule_alert',
						description: 'Schedules a generic alert or reminder task to be executed at a later time or when a specific condition is met. Use this for custom reminders or checks not covered by \'create_price_alert\'. The \'condition\' parameter requires specific backend logic to evaluate.',
						parameters: {
							type: 'object',
							properties: {
								type: {
									type: 'string',
									description: 'A category or label for the type of alert (e.g., "reminder", "wallet_activity_check", "portfolio_update", "custom_condition").',
								},
								condition: {
									type: 'string',
									description: 'Optional. A string describing the condition that triggers the alert. This requires backend logic to parse and evaluate periodically (e.g., "wallet_XXX_balance_gt_1000").',
								},
								message: {
									type: 'string',
									description: 'The notification message to send to the user when the alert is triggered.',
								},
								scheduled_for: {
									type: 'string',
									description: 'Optional. The specific time to trigger the alert, in ISO 8601 format (e.g., "2025-12-31T23:59:59Z"). If omitted, the alert relies solely on the \'condition\' being met.',
									format: 'date-time', // Hint for LLM about format
								},
							},
							required: [ 'type', 'message' ], // Either condition or scheduled_for must be meaningful
						},
						handlerFunction: 'actionScheduleAlert',
						category: 'Alerts',
						isActive: true,
					},
					{
						'name': 'search_chat_history',
						'description': 'Searches the history of the *current chat conversation* using semantic vector search to find past mentions, topics, or details based on user query. Use this *specifically* to answer questions about what was previously discussed or mentioned in *this specific chat*.',
						'parameters': {
							'type': 'object',
							'properties': {
								'query': {
									'type': 'string',
									'description': 'The natural language question or search phrase to find relevant parts of the conversation history.',
								},
								'limit': {
									'type': 'integer',
									'description': 'Optional. Maximum number of relevant conversation snippets to return. Default: 3.',
									'default': 3,
								},
							},
							'required': [ 'query' ],
						},
						'handlerFunction': 'actionSearchChatHistory', // Nuevo nombre de función handler
						'category': 'Memory',
						'isActive': true,
					},
					{
						name: 'semantic_query',
						description: 'Performs a natural language search (vector search) across previously stored conversation history or other indexed documents (e.g., data stored in ChromaDB). Useful for recalling past information, finding related context, or answering questions based on stored knowledge.',
						parameters: {
							type: 'object',
							properties: {
								query: {
									type: 'string',
									description: 'The natural language question or search phrase to query the vector database with.',
								},
								collection: {
									type: 'string',
									description: 'Optional. The specific collection name within the vector database to search (e.g., "chat-<chatId>", "token_data_SOL", "vybe_docs"). Defaults to the current chat context or a general knowledge base if unspecified.',
								},
								limit: {
									type: 'integer',
									description: 'Optional. Maximum number of relevant search results (documents/chunks) to return. Default: 5.',
									default: 5,
								},
							},
							required: [ 'query' ],
						},
						handlerFunction: 'actionSemanticQuery',
						category: 'Memory',
						isActive: true,
					},
					{
						name: 'evaluate_query_intent',
						description: 'Analyzes the user\'s query, potentially considering chat history, to determine if a semantic search (`semantic_query`) is the best way to answer it. If so, it can formulate an optimized search query and suggest the most relevant collection(s) to search within. Use this *before* `semantic_query` if unsure whether a vector search is appropriate or to refine the search.',
						parameters: {
							type: 'object',
							properties: {
								user_query: {
									type: 'string',
									description: 'The user\'s most recent question or request that might require searching stored knowledge.',
								},
								chat_history_summary: {
									type: 'string',
									description: 'Optional. A brief summary of the recent conversation context to aid intent evaluation.',
								},
								available_collections: {
									type: 'array',
									items: { type: 'string' },
									description: 'Optional. A list of known available collection names that can be searched via `semantic_query`.',
								},
							},
							required: [ 'user_query' ],
						},
						handlerFunction: 'actionEvaluateQueryIntent',
						category: 'Memory',
						isActive: true,
					},
					{
						name: 'get_known_accounts',
						description: 'Retrieves a list of known Solana accounts (wallets, programs) that have been labeled by Vybe or the community (e.g., \'CEX\', \'DeFi Protocol\', \'Influencer Wallet\', \'Scammer\'). Useful for identifying important or notable entities on the blockchain.',
						parameters: {
							type: 'object',
							properties: {
								owner_address: {
									type: 'string',
									description: 'Optional. Filter accounts that are owned or controlled by this specific address.',
								},
								labels: {
									type: 'string',
									description: 'Optional. Filter accounts having one or more specific labels, provided as a comma-separated list (e.g., "CEX,DEFI", "NFT Project").',
								},
								entity_name: {
									type: 'string',
									description: 'Optional. Filter accounts associated with a specific entity name (e.g., "Coinbase", "Raydium", "Tensor").',
								},
								limit: {
									type: 'integer',
									description: 'Optional. Maximum number of known accounts to return. Default: 10.',
									default: 10,
								},
								page: {
									type: 'integer',
									description: 'Optional. Page number for pagination. Default: 1.',
									default: 1,
								},
							},
							required: [],
						},
						handlerFunction: 'actionGetKnownAccounts',
						category: 'Account Info',
						isActive: true,
					}, // -----
					{
						name: 'get_wallet_tokens_time_series',
						description: 'Retrieves the daily historical balances (snapshot at end of day) of all SPL tokens held by a specific Solana wallet, presented as a time series. Useful for tracking portfolio composition changes over time.',
						parameters: {
							type: 'object',
							properties: {
								wallet_address: {
									type: 'string',
									description: 'The public key (address) of the Solana wallet.',
								},
								days: {
									type: 'integer',
									description: 'Optional. The number of past days of historical daily balance data to retrieve. Default: 30.',
									default: 30,
								},
							},
							required: [ 'wallet_address' ],
						},
						handlerFunction: 'actionGetWalletTokensTimeSeries',
						category: 'Wallet Info',
						isActive: true,
					}, // to test
					{
						name: 'get_token_transfers_analysis',
						description: 'Analyzes patterns in the transfer history of a specific Solana token over a given time window. Can focus on total volume transferred, frequency of transfers, or identify \'whale\' activity (wallets involved in large or frequent transfers).',
						parameters: {
							type: 'object',
							properties: {
								token_address: {
									type: 'string',
									description: 'The unique mint address of the Solana token.',
								},
								time_window: {
									type: 'string',
									description: 'The period over which to analyze transfers.',
									enum: [ '24h', '7d', '30d' ],
									default: '24h',
								},
								min_amount: {
									type: 'number',
									description: 'Optional. Minimum transfer amount (in native token units) to include in the analysis. Helps filter out dust transfers. Default: 0.',
									default: 0,
								},
								analysis_type: {
									type: 'string',
									description: 'The specific type of analysis to perform.',
									enum: [ 'volume', 'frequency', 'whales' ],
									default: 'volume',
								},
							},
							required: [ 'token_address' ],
						},
						handlerFunction: 'actionGetTokenTransfersAnalysis',
						category: 'Analysis',
						isActive: true,
					}, // -----
					{
						name: 'get_price_prediction',
						description: 'Generates a speculative price prediction for a specific Solana token for a future timeframe (e.g., 24h, 7d, 30d) based on historical price trends and volatility analysis. **Disclaimer: This is purely statistical and NOT financial advice.**',
						parameters: {
							type: 'object',
							properties: {
								token_address: {
									type: 'string',
									description: 'The unique mint address of the Solana token.',
								},
								timeframe: {
									type: 'string',
									description: 'The future timeframe for which to generate the prediction.',
									enum: [ '24h', '7d', '30d' ],
									default: '24h',
								},
								confidence_level: {
									type: 'string',
									description: 'Optional. Adjusts the confidence interval or range of the prediction ("low", "medium", "high"). Higher confidence usually means a wider range. Default: "medium".',
									enum: [ 'low', 'medium', 'high' ],
									default: 'medium',
								},
							},
							required: [ 'token_address' ],
						},
						handlerFunction: 'actionGetPricePrediction',
						category: 'Analysis',
						isActive: true,
					}, // testeado
					{
						name: 'compare_tokens',
						description: 'Compares two or more Solana tokens side-by-side across various selected metrics (like price, 24h volume, holder count, market cap, volatility) over a specified timeframe.',
						parameters: {
							type: 'object',
							properties: {
								token_addresses: {
									type: 'string', // Changed to string for comma-separated list
									description: 'A comma-separated list of the mint addresses for the tokens to compare (Requires at least two addresses). Example: "So1111...,DezXAZ..."',
								},
								metrics: {
									type: 'string',
									description: 'Optional. Comma-separated list of metrics to include in the comparison (e.g., "price,volume_24h,holders,marketCap,volatility"). Default includes common metrics.',
									default: 'price,volume_24h,holders,marketCap,price_change_24h',
								},
								timeframe: {
									type: 'string',
									description: 'The timeframe relevant for time-sensitive metrics like price change or volatility.',
									enum: [ '24h', '7d', '30d' ],
									default: '7d',
								},
							},
							required: [ 'token_addresses' ],
						},
						handlerFunction: 'actionCompareTokens',
						category: 'Analysis',
						isActive: true,
					}, // fix Vybe Call
					// Memory retrieval action
					{
						name: 'retrieve_memory_items',
						description: 'Retrieves memory items (user preferences, settings, saved information) from the current chat. Use this when the user asks about their previously stored information or preferences.',
						parameters: {
							type: 'object',
							properties: {
								query: {
									type: 'string',
									description: 'Search term or specific key to look for. Use "*" to retrieve all memory items.',
								},
								exact_match: {
									type: 'boolean',
									description: 'Whether to only return exact key matches (true) or also partial matches (false).',
									default: false,
								},
							},
							required: [ 'query' ],
						},
						handlerFunction: 'actionRetrieveMemoryItems',
						category: 'Memory',
						isActive: true,
					},
					// Memory objects retrieval action
					{
						name: 'retrieve_memory_objects',
						description: 'Retrieves stored memory objects (like trading strategies) for this chat. Use this when the user asks about their strategies, plans, or saved objects.',
						parameters: {
							type: 'object',
							properties: {
								type: {
									type: 'string',
									description: 'Type of memory objects to retrieve (e.g., "strategy"). Use "*" for all types.',
									default: '*',
								},
								name: {
									type: 'string',
									description: 'Optional. Specific name or partial name to search for.',
								},
							},
							required: [ 'type' ],
						},
						handlerFunction: 'actionRetrieveMemoryObjects',
						category: 'Memory',
						isActive: true,
					},
					// Token resolution action
					{
						name: 'resolve_token_addresses',
						description: 'Resolves token symbols or names mentioned in the user\'s query to their corresponding Solana addresses. Essential for blockchain data lookups. Use when the user mentions tokens by name or symbol.',
						parameters: {
							type: 'object',
							properties: {
								query: {
									type: 'string',
									description: 'The user query containing token symbols or names to resolve.',
								},
								limit: {
									type: 'integer',
									description: 'Maximum number of matches to return per potential token.',
									default: 3,
								},
							},
							required: [ 'query' ],
						},
						handlerFunction: 'actionResolveTokenAddresses',
						category: 'Token Info',
						isActive: true,
					},
					{
						name: 'store_user_name',
						description: 'Stores the user\'s name in memory for personalized interactions.',
						parameters: {
							type: 'object',
							properties: {
								name: {
									type: 'string',
									description: 'The user\'s name to store.',
								},
							},
							required: [ 'name' ],
						},
						handlerFunction: 'storeUserName',
						category: 'User Profile',
						isActive: true,
					},
					{
						name: 'store_risk_tolerance',
						description: 'Stores the user\'s risk tolerance level for investment recommendations.',
						parameters: {
							type: 'object',
							properties: {
								risk_level: {
									type: 'string',
									description: 'The user\'s risk tolerance level.',
									enum: [ 'low', 'medium', 'high' ],
								},
							},
							required: [ 'risk_level' ],
						},
						handlerFunction: 'storeRiskTolerance',
						category: 'User Profile',
						isActive: true,
					},
					{
						name: 'store_investment_timeframe',
						description: 'Stores the user\'s preferred investment timeframe.',
						parameters: {
							type: 'object',
							properties: {
								timeframe: {
									type: 'string',
									description: 'The user\'s investment timeframe preference.',
									enum: [ 'short', 'medium', 'long' ],
								},
							},
							required: [ 'timeframe' ],
						},
						handlerFunction: 'storeInvestmentTimeframe',
						category: 'User Profile',
						isActive: true,
					},
					{
						name: 'store_favorite_tokens',
						description: 'Stores the user\'s favorite or watched tokens.',
						parameters: {
							type: 'object',
							properties: {
								tokens: {
									type: 'string',
									description: 'Comma-separated list of token symbols or addresses.',
								},
							},
							required: [ 'tokens' ],
						},
						handlerFunction: 'storeFavoriteTokens',
						category: 'User Profile',
						isActive: true,
					},
					{
						name: 'store_investment_goals',
						description: 'Stores the user\'s investment goals and objectives.',
						parameters: {
							type: 'object',
							properties: {
								goals: {
									type: 'string',
									description: 'Description of the user\'s investment goals.',
								},
							},
							required: [ 'goals' ],
						},
						handlerFunction: 'storeInvestmentGoals',
						category: 'User Profile',
						isActive: true,
					},
					{
						name: 'store_trading_experience',
						description: 'Stores the user\'s trading experience level.',
						parameters: {
							type: 'object',
							properties: {
								level: {
									type: 'string',
									description: 'The user\'s trading experience level.',
									enum: [ 'beginner', 'intermediate', 'advanced' ],
								},
							},
							required: [ 'level' ],
						},
						handlerFunction: 'storeTradingExperience',
						category: 'User Profile',
						isActive: true,
					},
					{
						name: 'store_notification_preferences',
						description: 'Stores the user\'s preferences for notifications and alerts.',
						parameters: {
							type: 'object',
							properties: {
								preferences: {
									type: 'object',
									description: 'Object containing notification preferences (price_alerts, whale_movements, news, trending_tokens, daily_summary).',
								},
							},
							required: [ 'preferences' ],
						},
						handlerFunction: 'storeNotificationPreferences',
						category: 'User Profile',
						isActive: true,
					},
					{
						name: 'upsert_trading_strategy',
						description: 'Creates or updates a trading strategy with detailed structured data.',
						parameters: {
							type: 'object',
							properties: {
								name: {
									type: 'string',
									description: 'A unique and descriptive name for the strategy.',
								},
								description: {
									type: 'string',
									description: 'A detailed explanation of the strategy\'s goals and methods.',
								},
								tokens: {
									type: 'array',
									items: { type: 'string' },
									description: 'A list of token symbols or addresses the strategy focuses on.',
								},
								rules: {
									type: 'string',
									description: 'Optional. Specific conditions or triggers for the strategy.',
								},
								timeframe: {
									type: 'string',
									description: 'The intended duration or outlook of the strategy.',
									enum: [ 'short-term', 'medium-term', 'long-term', 'ongoing' ],
								},
								riskLevel: {
									type: 'string',
									description: 'Optional. Risk level associated with this strategy.',
									enum: [ 'low', 'medium', 'high' ],
								},
								entryConditions: {
									type: 'array',
									items: { type: 'string' },
									description: 'Optional. List of conditions that should be met to enter positions.',
								},
								exitConditions: {
									type: 'array',
									items: { type: 'string' },
									description: 'Optional. List of conditions that should be met to exit positions.',
								},
								stopLoss: {
									type: 'string',
									description: 'Optional. Stop loss strategy or percentage.',
								},
								takeProfit: {
									type: 'string',
									description: 'Optional. Take profit strategy or percentage.',
								},
							},
							required: [ 'name', 'description', 'tokens', 'timeframe' ],
						},
						handlerFunction: 'upsertTradingStrategy',
						category: 'Strategies',
						isActive: true,
					},
					{
						name: 'upsert_token_watchlist',
						description: 'Creates or updates a token watchlist for monitoring specific tokens.',
						parameters: {
							type: 'object',
							properties: {
								name: {
									type: 'string',
									description: 'A unique name for the watchlist.',
								},
								tokens: {
									type: 'array',
									items: { type: 'string' },
									description: 'List of token symbols or addresses to watch.',
								},
								description: {
									type: 'string',
									description: 'Optional. A description of the watchlist purpose.',
								},
								criteria: {
									type: 'string',
									description: 'Optional. Specific criteria for selecting these tokens.',
								},
							},
							required: [ 'name', 'tokens' ],
						},
						handlerFunction: 'upsertTokenWatchlist',
						category: 'Watchlists',
						isActive: true,
					},
					{
						name: 'upsert_portfolio_plan',
						description: 'Creates or updates a portfolio allocation plan with token percentages.',
						parameters: {
							type: 'object',
							properties: {
								name: {
									type: 'string',
									description: 'A unique name for the portfolio plan.',
								},
								description: {
									type: 'string',
									description: 'Optional. A description of the portfolio strategy.',
								},
								allocations: {
									type: 'array',
									items: {
										type: 'object',
										properties: {
											token: { type: 'string' },
											percentage: { type: 'number' },
											rationale: { type: 'string' },
										},
									},
									description: 'Array of allocations with token, percentage, and optional rationale.',
								},
								timeframe: {
									type: 'string',
									description: 'Optional. Investment timeframe for this portfolio.',
									enum: [ 'short-term', 'medium-term', 'long-term' ],
								},
								riskLevel: {
									type: 'string',
									description: 'Optional. Risk level of this portfolio strategy.',
									enum: [ 'low', 'medium', 'high' ],
								},
								rebalanceFrequency: {
									type: 'string',
									description: 'Optional. How often to rebalance this portfolio.',
								},
							},
							required: [ 'name', 'allocations' ],
						},
						handlerFunction: 'upsertPortfolioPlan',
						category: 'Portfolio',
						isActive: true,
					},
					{
						name: 'upsert_trade_setup',
						description: 'Creates or updates a specific trade setup with entry, exit, and risk management details.',
						parameters: {
							type: 'object',
							properties: {
								token: {
									type: 'string',
									description: 'The token symbol for this trade.',
								},
								direction: {
									type: 'string',
									description: 'Trade direction (long/short).',
									enum: [ 'long', 'short' ],
								},
								entryPrice: {
									type: 'number',
									description: 'The entry price for this trade.',
								},
								stopLoss: {
									type: 'number',
									description: 'Optional. The stop loss price.',
								},
								takeProfit: {
									type: 'number',
									description: 'Optional. The take profit price.',
								},
								tokenAddress: {
									type: 'string',
									description: 'Optional. The token address if known.',
								},
								timeframe: {
									type: 'string',
									description: 'Optional. Timeframe for this trade.',
								},
								rationale: {
									type: 'string',
									description: 'Optional. Reasoning behind this trade setup.',
								},
								status: {
									type: 'string',
									description: 'Optional. Current status of this trade.',
									enum: [ 'planned', 'active', 'completed', 'canceled' ],
								},
							},
							required: [ 'token', 'direction', 'entryPrice' ],
						},
						handlerFunction: 'upsertTradeSetup',
						category: 'Trading',
						isActive: true,
					},
					{
						name: 'upsert_market_analysis',
						description: 'Creates or updates a market analysis record with insights about current market conditions.',
						parameters: {
							type: 'object',
							properties: {
								title: {
									type: 'string',
									description: 'A descriptive title for this analysis.',
								},
								content: {
									type: 'string',
									description: 'The full analysis content.',
								},
								summary: {
									type: 'string',
									description: 'Optional. A brief summary of key points.',
								},
								tokens: {
									type: 'array',
									items: { type: 'string' },
									description: 'Optional. List of tokens covered in this analysis.',
								},
								marketCondition: {
									type: 'string',
									description: 'Optional. Overall market sentiment assessment.',
									enum: [ 'bullish', 'bearish', 'neutral' ],
								},
								timeframe: {
									type: 'string',
									description: 'Optional. Timeframe this analysis applies to.',
								},
								sentimentScore: {
									type: 'number',
									description: 'Optional. Numerical sentiment score (-10 to 10).',
								},
								keyFactors: {
									type: 'array',
									items: { type: 'string' },
									description: 'Optional. Key factors influencing this analysis.',
								},
								recommendations: {
									type: 'array',
									items: { type: 'string' },
									description: 'Optional. Specific recommendations based on this analysis.',
								},
							},
							required: [ 'title', 'content' ],
						},
						handlerFunction: 'upsertMarketAnalysis',
						category: 'Analysis',
						isActive: true,
					},
					{
						'name': 'get_user_name',
						'description': 'Retrieves the user\'s previously stored name for the current chat.',
						'parameters': { 'type': 'object', 'properties': {} },
						'handlerFunction': 'actionGetUserName',
						'category': 'User Profile',
						'isActive': true,
					},
					{
						'name': 'get_risk_tolerance',
						'description': 'Retrieves the user\'s previously stored risk tolerance level (low, medium, high) for the current chat.',
						'parameters': { 'type': 'object', 'properties': {} },
						'handlerFunction': 'actionGetRiskTolerance',
						'category': 'User Profile',
						'isActive': true,
					},
					{
						'name': 'get_investment_timeframe',
						'description': 'Retrieves the user\'s previously stored investment timeframe preference (short, medium, long) for the current chat.',
						'parameters': { 'type': 'object', 'properties': {} },
						'handlerFunction': 'actionGetInvestmentTimeframe',
						'category': 'User Profile',
						'isActive': true,
					},
					{
						'name': 'get_favorite_tokens',
						'description': 'Retrieves the user\'s previously stored list of favorite or watched tokens for the current chat.',
						'parameters': { 'type': 'object', 'properties': {} },
						'handlerFunction': 'actionGetFavoriteTokens',
						'category': 'User Profile',
						'isActive': true,
					},
					{
						'name': 'get_investment_goals',
						'description': 'Retrieves the user\'s previously stored investment goals description for the current chat.',
						'parameters': { 'type': 'object', 'properties': {} },
						'handlerFunction': 'actionGetInvestmentGoals',
						'category': 'User Profile',
						'isActive': true,
					},
					{
						'name': 'get_trading_experience',
						'description': 'Retrieves the user\'s previously stored trading experience level (beginner, intermediate, advanced) for the current chat.',
						'parameters': { 'type': 'object', 'properties': {} },
						'handlerFunction': 'actionGetTradingExperience',
						'category': 'User Profile',
						'isActive': true,
					},
					{
						'name': 'get_notification_preferences',
						'description': 'Retrieves the user\'s previously stored notification preferences for the current chat.',
						'parameters': { 'type': 'object', 'properties': {} },
						'handlerFunction': 'actionGetNotificationPreferences',
						'category': 'User Profile',
						'isActive': true,
					},
					{
						'name': 'get_trading_strategies',
						'description': 'Retrieves previously saved trading strategies for the user. Can optionally filter by strategy name.',
						'parameters': {
							'type': 'object',
							'properties': {
								'name': {
									'type': 'string',
									'description': 'Optional. The exact or partial name of the strategy to retrieve.',
								},
								'limit': {
									'type': 'integer',
									'description': 'Optional. Maximum number of strategies to return. Default: 5.',
									'default': 5,
								},
							},
							'required': [],
						},
						'handlerFunction': 'actionGetTradingStrategies',
						'category': 'Strategies',
						'isActive': true,
					},
					{
						'name': 'get_token_watchlists',
						'description': 'Retrieves previously saved token watchlists for the user. Can optionally filter by watchlist name.',
						'parameters': {
							'type': 'object',
							'properties': {
								'name': {
									'type': 'string',
									'description': 'Optional. The exact or partial name of the watchlist to retrieve.',
								},
								'limit': {
									'type': 'integer',
									'description': 'Optional. Maximum number of watchlists to return. Default: 5.',
									'default': 5,
								},
							},
							'required': [],
						},
						'handlerFunction': 'actionGetTokenWatchlists',
						'category': 'Watchlists',
						'isActive': true,
					},
					{
						'name': 'get_portfolio_plans',
						'description': 'Retrieves previously saved portfolio allocation plans for the user. Can optionally filter by plan name.',
						'parameters': {
							'type': 'object',
							'properties': {
								'name': {
									'type': 'string',
									'description': 'Optional. The exact or partial name of the portfolio plan to retrieve.',
								},
								'limit': {
									'type': 'integer',
									'description': 'Optional. Maximum number of plans to return. Default: 5.',
									'default': 5,
								},
							},
							'required': [],
						},
						'handlerFunction': 'actionGetPortfolioPlans',
						'category': 'Portfolio',
						'isActive': true,
					},
					{
						'name': 'get_trade_setups',
						'description': 'Retrieves previously saved trade setups for the user. Can optionally filter by token symbol or status.',
						'parameters': {
							'type': 'object',
							'properties': {
								'token': {
									'type': 'string',
									'description': 'Optional. Filter trade setups for a specific token symbol.',
								},
								'status': {
									'type': 'string',
									'description': 'Optional. Filter trade setups by their status.',
									'enum': [ 'planned', 'active', 'completed', 'canceled' ],
								},
								'limit': {
									'type': 'integer',
									'description': 'Optional. Maximum number of setups to return. Default: 10.',
									'default': 10,
								},
							},
							'required': [],
						},
						'handlerFunction': 'actionGetTradeSetups',
						'category': 'Trading',
						'isActive': true,
					},
					{
						'name': 'get_market_analyses',
						'description': 'Retrieves previously saved market analysis records. Can optionally filter by title.',
						'parameters': {
							'type': 'object',
							'properties': {
								'title': {
									'type': 'string',
									'description': 'Optional. The exact or partial title of the analysis to retrieve.',
								},
								'limit': {
									'type': 'integer',
									'description': 'Optional. Maximum number of analyses to return. Default: 5.',
									'default': 5,
								},
							},
							'required': [],
						},
						'handlerFunction': 'actionGetMarketAnalyses',
						'category': 'Analysis',
						'isActive': true,
					},
				],
			};
			this.logger.success('Successfully loaded available actions.', { count: actions.actions.length });
			this.logger.exit('loadAvailableActions', { actionCount: actions.actions.length });
			return actions;
		} catch(error) {
			this.logger.error('Failed to load available actions', error);
			this.logger.exit('loadAvailableActions', { error: true });
			// Log error appropriately in production
			return { actions: [] };
		}
	}

	/**
	 * Stores user's name in memory
	 * @param {number} chatId - The chat ID
	 * @param {string} name - User's name
	 * @returns {Promise<Object>} Result with stored item
	 */
	async storeUserName(chatId, name) {
		const functionName = 'storeUserName';
		this.logger.entry(functionName, { chatId, name });

		if(!name || typeof name !== 'string') {
			this.logger.error('Invalid name provided', { name });
			throw new Error('Valid name is required');
		}

		try {
			const result = await this.actionRememberInfo(chatId, {
				key: 'user_name',
				value: name.trim(),
				source: 'user',
				confidence: 1.0,
			});

			this.logger.success(`Stored user name: ${ name }`);
			this.logger.exit(functionName, result);
			return result;
		} catch(error) {
			this.logger.error(`Failed to store user name`, error);
			this.logger.exit(functionName, { error: true });
			throw error;
		}
	}

	/**
	 * Stores user's risk tolerance level
	 * @param {number} chatId - The chat ID
	 * @param {string} riskLevel - 'low', 'medium', or 'high'
	 * @returns {Promise<Object>} Result with stored item
	 */
	async storeRiskTolerance(chatId, riskLevel) {
		const functionName = 'storeRiskTolerance';
		this.logger.entry(functionName, { chatId, riskLevel });

		const validLevels = [ 'low', 'medium', 'high' ];
		const normalizedLevel = riskLevel.toLowerCase().trim();

		if(!validLevels.includes(normalizedLevel)) {
			this.logger.error('Invalid risk level', { riskLevel });
			throw new Error('Risk level must be low, medium, or high');
		}

		try {
			const result = await this.actionRememberInfo(chatId, {
				key: 'risk_tolerance',
				value: normalizedLevel,
				source: 'user',
				confidence: 1.0,
			});

			this.logger.success(`Stored risk tolerance: ${ normalizedLevel }`);
			this.logger.exit(functionName, result);
			return result;
		} catch(error) {
			this.logger.error(`Failed to store risk tolerance`, error);
			this.logger.exit(functionName, { error: true });
			throw error;
		}
	}

	/**
	 * Stores user's investment timeframe preference
	 * @param {number} chatId - The chat ID
	 * @param {string} timeframe - 'short', 'medium', or 'long'
	 * @returns {Promise<Object>} Result with stored item
	 */
	async storeInvestmentTimeframe(chatId, timeframe) {
		const functionName = 'storeInvestmentTimeframe';
		this.logger.entry(functionName, { chatId, timeframe });

		const validTimeframes = [ 'short', 'medium', 'long' ];
		const normalizedTimeframe = timeframe.toLowerCase().trim();

		if(!validTimeframes.includes(normalizedTimeframe)) {
			this.logger.error('Invalid timeframe', { timeframe });
			throw new Error('Timeframe must be short, medium, or long');
		}

		try {
			const result = await this.actionRememberInfo(chatId, {
				key: 'investment_timeframe',
				value: normalizedTimeframe,
				source: 'user',
				confidence: 1.0,
			});

			this.logger.success(`Stored investment timeframe: ${ normalizedTimeframe }`);
			this.logger.exit(functionName, result);
			return result;
		} catch(error) {
			this.logger.error(`Failed to store investment timeframe`, error);
			this.logger.exit(functionName, { error: true });
			throw error;
		}
	}

	/**
	 * Stores user's favorite tokens as a structured array
	 * @param {number} chatId - The chat ID
	 * @param {Array|string} tokens - Array of token symbols or comma-separated string
	 * @returns {Promise<Object>} Result with stored item
	 */
	async storeFavoriteTokens(chatId, tokens) {
		const functionName = 'storeFavoriteTokens';
		this.logger.entry(functionName, { chatId, tokens });

		let tokenList = [];

		if(typeof tokens === 'string') {
			tokenList = tokens.split(',').map(t => t.trim().toUpperCase()).filter(t => t);
		} else if(Array.isArray(tokens)) {
			tokenList = tokens.map(t => String(t).trim().toUpperCase()).filter(t => t);
		} else {
			this.logger.error('Invalid tokens format', { tokens });
			throw new Error('Tokens must be an array or comma-separated string');
		}

		if(tokenList.length === 0) {
			this.logger.error('Empty token list', { tokens });
			throw new Error('At least one token must be provided');
		}

		try {
			const result = await this.actionRememberInfo(chatId, {
				key: 'favorite_tokens',
				value: JSON.stringify(tokenList),
				type: 'json',
				source: 'user',
				confidence: 1.0,
			});

			this.logger.success(`Stored favorite tokens: ${ tokenList.join(', ') }`);
			this.logger.exit(functionName, result);
			return result;
		} catch(error) {
			this.logger.error(`Failed to store favorite tokens`, error);
			this.logger.exit(functionName, { error: true });
			throw error;
		}
	}

	/**
	 * Stores user's investment goals
	 * @param {number} chatId - The chat ID
	 * @param {string} goals - Investment goals description
	 * @returns {Promise<Object>} Result with stored item
	 */
	async storeInvestmentGoals(chatId, goals) {
		const functionName = 'storeInvestmentGoals';
		this.logger.entry(functionName, { chatId, goals: goals?.substring(0, 50) + '...' });

		if(!goals || typeof goals !== 'string') {
			this.logger.error('Invalid goals provided', { goals });
			throw new Error('Valid investment goals description is required');
		}

		try {
			const result = await this.actionRememberInfo(chatId, {
				key: 'investment_goals',
				value: goals.trim(),
				source: 'user',
				confidence: 1.0,
			});

			this.logger.success(`Stored investment goals`);
			this.logger.exit(functionName, result);
			return result;
		} catch(error) {
			this.logger.error(`Failed to store investment goals`, error);
			this.logger.exit(functionName, { error: true });
			throw error;
		}
	}

	/**
	 * Stores user's trading experience level
	 * @param {number} chatId - The chat ID
	 * @param {string} level - 'beginner', 'intermediate', or 'advanced'
	 * @returns {Promise<Object>} Result with stored item
	 */
	async storeTradingExperience(chatId, level) {
		const functionName = 'storeTradingExperience';
		this.logger.entry(functionName, { chatId, level });

		const validLevels = [ 'beginner', 'intermediate', 'advanced' ];
		const normalizedLevel = level.toLowerCase().trim();

		if(!validLevels.includes(normalizedLevel)) {
			this.logger.error('Invalid experience level', { level });
			throw new Error('Experience level must be beginner, intermediate, or advanced');
		}

		try {
			const result = await this.actionRememberInfo(chatId, {
				key: 'trading_experience',
				value: normalizedLevel,
				source: 'user',
				confidence: 1.0,
			});

			this.logger.success(`Stored trading experience: ${ normalizedLevel }`);
			this.logger.exit(functionName, result);
			return result;
		} catch(error) {
			this.logger.error(`Failed to store trading experience`, error);
			this.logger.exit(functionName, { error: true });
			throw error;
		}
	}

	/**
	 * Stores user's notification preferences
	 * @param {number} chatId - The chat ID
	 * @param {Object} preferences - Notification preferences object
	 * @returns {Promise<Object>} Result with stored item
	 */
	async storeNotificationPreferences(chatId, preferences) {
		const functionName = 'storeNotificationPreferences';
		this.logger.entry(functionName, { chatId, preferences });

		if(!preferences || typeof preferences !== 'object') {
			this.logger.error('Invalid preferences format', { preferences });
			throw new Error('Preferences must be provided as an object');
		}

		// Default preferences with provided overrides
		const defaultPrefs = {
			price_alerts: true,
			whale_movements: false,
			news: true,
			trending_tokens: false,
			daily_summary: false,
		};

		const finalPrefs = { ...defaultPrefs, ...preferences };

		try {
			const result = await this.actionRememberInfo(chatId, {
				key: 'notification_preferences',
				value: JSON.stringify(finalPrefs),
				type: 'json',
				source: 'user',
				confidence: 1.0,
			});

			this.logger.success(`Stored notification preferences`);
			this.logger.exit(functionName, result);
			return result;
		} catch(error) {
			this.logger.error(`Failed to store notification preferences`, error);
			this.logger.exit(functionName, { error: true });
			throw error;
		}
	}

	/**
	 * Creates or updates a trading strategy with structured data
	 * @param {number} chatId - The chat ID
	 * @param {Object} strategyData - Strategy details
	 * @returns {Promise<Object>} Result with created/updated strategy
	 */
	async upsertTradingStrategy(chatId, strategyData) {
		const functionName = 'upsertTradingStrategy';
		this.logger.entry(functionName, {
			chatId,
			strategyData: {
				...strategyData,
				tokens: strategyData.tokens ? `[${ strategyData.tokens.length } tokens]` : undefined,
			},
		});

		// Validate required fields
		if(!strategyData.name || !strategyData.description) {
			this.logger.error('Missing required strategy fields', { strategyData });
			throw new Error('Strategy requires name and description');
		}

		// Process tokens
		let tokensList = [];
		if(typeof strategyData.tokens === 'string') {
			if(strategyData.tokens.trim().startsWith('[') && strategyData.tokens.trim().endsWith(']')) {
				try {
					tokensList = JSON.parse(strategyData.tokens);
					if(!Array.isArray(tokensList)) throw new Error('Parsed result is not an array');
				} catch(e) {
					tokensList = strategyData.tokens.replace(/^\[|\]$/g, '').split(',').map(t => t.trim())
						.filter(t => t);
				}
			} else if(strategyData.tokens.trim()) {
				tokensList = strategyData.tokens.split(',').map(t => t.trim()).filter(t => t);
			}
		} else if(Array.isArray(strategyData.tokens)) {
			tokensList = strategyData.tokens;
		}

		// Ensure timeframe is valid
		const validTimeframes = [ 'short-term', 'medium-term', 'long-term', 'ongoing' ];
		if(!validTimeframes.includes(strategyData.timeframe)) {
			this.logger.warn(`Invalid timeframe '${ strategyData.timeframe }', defaulting to 'medium-term'`);
			strategyData.timeframe = 'medium-term';
		}

		// Create structured data object
		const fullStrategyData = {
			name: strategyData.name,
			description: strategyData.description,
			tokens: tokensList,
			rules: strategyData.rules || '',
			timeframe: strategyData.timeframe,
			riskLevel: strategyData.riskLevel || 'medium',
			entryConditions: strategyData.entryConditions || [],
			exitConditions: strategyData.exitConditions || [],
			stopLoss: strategyData.stopLoss || null,
			takeProfit: strategyData.takeProfit || null,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};

		try {
			// Check if a strategy with this name already exists
			const existingStrategy = await this.prisma.memoryObject.findFirst({
				where: {
					chatId,
					objectType: 'strategy',
					name: strategyData.name,
					isActive: true,
				},
			});

			let result;

			if(existingStrategy) {
				// Update existing strategy
				const updatedStrategy = await this.prisma.memoryObject.update({
					where: { id: existingStrategy.id },
					data: {
						data: {
							...existingStrategy.data,
							...fullStrategyData,
							createdAt: existingStrategy.data.createdAt, // Keep original creation date
							updatedAt: new Date().toISOString(),
						},
					},
				});

				result = {
					updated: true,
					created: false,
					strategy: {
						id: updatedStrategy.id,
						name: fullStrategyData.name,
						description: fullStrategyData.description,
						tokens: tokensList,
						timeframe: fullStrategyData.timeframe,
						details: fullStrategyData,
					},
				};

				this.logger.success(`Updated trading strategy '${ fullStrategyData.name }'`);
			} else {
				// Create new strategy using existing function
				const createResult = await this.actionCreateStrategy(chatId, {
					name: fullStrategyData.name,
					description: fullStrategyData.description,
					tokens: tokensList,
					rules: fullStrategyData.rules,
					timeframe: fullStrategyData.timeframe,
				});

				// Add the enriched data to the result
				createResult.strategy.details = fullStrategyData;
				result = {
					...createResult,
					updated: false,
					created: true,
				};

				this.logger.success(`Created trading strategy '${ fullStrategyData.name }'`);
			}

			this.logger.exit(functionName, result);
			return result;

		} catch(error) {
			this.logger.error(`Failed to upsert trading strategy`, error);
			this.logger.exit(functionName, { error: true });
			throw error;
		}
	}

	/**
	 * Creates or updates a token watchlist
	 * @param {number} chatId - The chat ID
	 * @param {Object} watchlistData - Watchlist details
	 * @returns {Promise<Object>} Result with created/updated watchlist
	 */
	async upsertTokenWatchlist(chatId, watchlistData) {
		const functionName = 'upsertTokenWatchlist';
		this.logger.entry(functionName, { chatId, watchlistData });

		// Validate required fields
		if(!watchlistData.name || !watchlistData.tokens || !watchlistData.tokens.length) {
			this.logger.error('Invalid watchlist data', { watchlistData });
			throw new Error('Watchlist requires name and at least one token');
		}

		// Process tokens
		let tokensList = [];
		if(typeof watchlistData.tokens === 'string') {
			tokensList = watchlistData.tokens.split(',').map(t => t.trim()).filter(t => t);
		} else if(Array.isArray(watchlistData.tokens)) {
			tokensList = watchlistData.tokens.map(t => String(t).trim()).filter(t => t);
		}

		if(tokensList.length === 0) {
			this.logger.error('No valid tokens for watchlist', { watchlistData });
			throw new Error('Watchlist requires at least one valid token');
		}

		// Create watchlist object
		const watchlistObj = {
			objectType: 'watchlist',
			name: watchlistData.name,
			description: watchlistData.description || `Watchlist for ${ tokensList.join(', ') }`,
			tokens: tokensList,
			criteria: watchlistData.criteria || 'general',
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			isActive: true,
		};

		try {
			// Check if a watchlist with this name already exists
			const existingWatchlist = await this.prisma.memoryObject.findFirst({
				where: {
					chatId,
					objectType: 'watchlist',
					name: watchlistData.name,
					isActive: true,
				},
			});

			let result;

			if(existingWatchlist) {
				// Update existing watchlist
				const updatedWatchlist = await this.prisma.memoryObject.update({
					where: { id: existingWatchlist.id },
					data: {
						data: {
							...existingWatchlist.data,
							...watchlistObj,
							createdAt: existingWatchlist.data.createdAt, // Keep original creation date
							updatedAt: new Date().toISOString(),
						},
					},
				});

				result = {
					updated: true,
					created: false,
					watchlist: {
						id: updatedWatchlist.id,
						name: watchlistObj.name,
						tokens: tokensList,
						description: watchlistObj.description,
					},
				};

				this.logger.success(`Updated token watchlist '${ watchlistObj.name }'`);
			} else {
				// Create new watchlist
				const watchlist = await this.prisma.memoryObject.create({
					data: {
						chatId,
						objectType: 'watchlist',
						name: watchlistObj.name,
						data: watchlistObj,
						isActive: true,
					},
				});

				result = {
					updated: false,
					created: true,
					watchlist: {
						id: watchlist.id,
						name: watchlistObj.name,
						tokens: tokensList,
						description: watchlistObj.description,
					},
				};

				this.logger.success(`Created token watchlist '${ watchlistObj.name }' with ${ tokensList.length } tokens`);
			}

			this.logger.exit(functionName, result);
			return result;

		} catch(error) {
			this.logger.error(`Failed to upsert token watchlist`, error);
			this.logger.exit(functionName, { error: true });
			throw error;
		}
	}

	/**
	 * Creates or updates a portfolio allocation plan
	 * @param {number} chatId - The chat ID
	 * @param {Object} portfolioData - Portfolio allocation details
	 * @returns {Promise<Object>} Result with created/updated portfolio plan
	 */
	async upsertPortfolioPlan(chatId, portfolioData) {
		const functionName = 'upsertPortfolioPlan';
		this.logger.entry(functionName, { chatId, portfolioData });

		// Validate required fields
		if(!portfolioData.name || !portfolioData.allocations || !Array.isArray(portfolioData.allocations)) {
			this.logger.error('Invalid portfolio data', { portfolioData });
			throw new Error('Portfolio plan requires name and allocations array');
		}

		// Validate allocations
		let totalPercentage = 0;
		const validatedAllocations = portfolioData.allocations.map(item => {
			if(!item.token || !item.percentage || isNaN(parseFloat(item.percentage))) {
				throw new Error('Each allocation must have token and percentage');
			}

			const allocation = {
				token: item.token.trim(),
				percentage: parseFloat(item.percentage),
				rationale: item.rationale || '',
			};

			totalPercentage += allocation.percentage;
			return allocation;
		});

		// Check total is reasonable (allow slight rounding errors)
		if(Math.abs(totalPercentage - 100) > 1) {
			this.logger.error(`Total allocation percentage (${ totalPercentage }%) is not close to 100%`);
			throw new Error('Allocation percentages must sum to approximately 100%');
		}

		// Create portfolio object
		const portfolioObj = {
			objectType: 'portfolio_plan',
			name: portfolioData.name,
			description: portfolioData.description || 'Portfolio allocation plan',
			timeframe: portfolioData.timeframe || 'medium-term',
			riskLevel: portfolioData.riskLevel || 'medium',
			allocations: validatedAllocations,
			rebalanceFrequency: portfolioData.rebalanceFrequency || 'monthly',
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};

		try {
			// Check if a portfolio with this name already exists
			const existingPortfolio = await this.prisma.memoryObject.findFirst({
				where: {
					chatId,
					objectType: 'portfolio_plan',
					name: portfolioData.name,
					isActive: true,
				},
			});

			let result;

			if(existingPortfolio) {
				// Update existing portfolio plan
				const updatedPortfolio = await this.prisma.memoryObject.update({
					where: { id: existingPortfolio.id },
					data: {
						data: {
							...existingPortfolio.data,
							...portfolioObj,
							createdAt: existingPortfolio.data.createdAt, // Keep original creation date
							updatedAt: new Date().toISOString(),
						},
					},
				});

				result = {
					updated: true,
					created: false,
					portfolio: {
						id: updatedPortfolio.id,
						name: portfolioObj.name,
						timeframe: portfolioObj.timeframe,
						riskLevel: portfolioObj.riskLevel,
						tokenCount: validatedAllocations.length,
					},
				};

				this.logger.success(`Updated portfolio plan '${ portfolioObj.name }'`);
			} else {
				// Create new portfolio plan
				const portfolio = await this.prisma.memoryObject.create({
					data: {
						chatId,
						objectType: 'portfolio_plan',
						name: portfolioObj.name,
						data: portfolioObj,
						isActive: true,
					},
				});

				result = {
					updated: false,
					created: true,
					portfolio: {
						id: portfolio.id,
						name: portfolioObj.name,
						timeframe: portfolioObj.timeframe,
						riskLevel: portfolioObj.riskLevel,
						tokenCount: validatedAllocations.length,
					},
				};

				this.logger.success(`Created portfolio plan '${ portfolioObj.name }' with ${ validatedAllocations.length } allocations`);
			}

			this.logger.exit(functionName, result);
			return result;

		} catch(error) {
			this.logger.error(`Failed to upsert portfolio plan`, error);
			this.logger.exit(functionName, { error: true });
			throw error;
		}
	}

	/**
	 * Creates or updates a trade setup
	 * @param {number} chatId - The chat ID
	 * @param {Object} tradeData - Trade setup details
	 * @returns {Promise<Object>} Result with created/updated trade setup
	 */
	async upsertTradeSetup(chatId, tradeData) {
		const functionName = 'upsertTradeSetup';
		this.logger.entry(functionName, { chatId, tradeData });

		// Validate required fields
		if(!tradeData.token || !tradeData.direction || !tradeData.entryPrice) {
			this.logger.error('Invalid trade setup data', { tradeData });
			throw new Error('Trade setup requires token, direction, and entry price');
		}

		// Validate direction
		if(![ 'long', 'short' ].includes(tradeData.direction.toLowerCase())) {
			this.logger.error('Invalid trade direction', { direction: tradeData.direction });
			throw new Error('Trade direction must be either "long" or "short"');
		}

		// Parse numerical values
		const entryPrice = parseFloat(tradeData.entryPrice);
		const stopLoss = tradeData.stopLoss ? parseFloat(tradeData.stopLoss) : null;
		const takeProfit = tradeData.takeProfit ? parseFloat(tradeData.takeProfit) : null;

		if(isNaN(entryPrice) || entryPrice <= 0) {
			this.logger.error('Invalid entry price', { entryPrice: tradeData.entryPrice });
			throw new Error('Entry price must be a positive number');
		}

		// Create trade setup object
		const setupName = `${ tradeData.direction.toUpperCase() } ${ tradeData.token } at $${ entryPrice }`;
		const tradeObj = {
			objectType: 'trade_setup',
			name: setupName,
			token: tradeData.token.trim(),
			tokenAddress: tradeData.tokenAddress || null,
			direction: tradeData.direction.toLowerCase(),
			entryPrice: entryPrice,
			stopLoss: stopLoss,
			takeProfit: takeProfit,
			riskRewardRatio: stopLoss && takeProfit ?
				Math.abs((takeProfit - entryPrice) / (entryPrice - stopLoss)).toFixed(2) : null,
			timeframe: tradeData.timeframe || 'short-term',
			entryConditions: tradeData.entryConditions || [],
			exitConditions: tradeData.exitConditions || [],
			rationale: tradeData.rationale || '',
			status: tradeData.status || 'planned', // planned, active, completed, canceled
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};

		try {
			// Check if a trade setup with this name already exists
			const existingSetup = await this.prisma.memoryObject.findFirst({
				where: {
					chatId,
					objectType: 'trade_setup',
					name: setupName,
					isActive: true,
				},
			});

			let result;

			if(existingSetup) {
				// Update existing trade setup
				const updatedSetup = await this.prisma.memoryObject.update({
					where: { id: existingSetup.id },
					data: {
						data: {
							...existingSetup.data,
							...tradeObj,
							createdAt: existingSetup.data.createdAt, // Keep original creation date
							updatedAt: new Date().toISOString(),
						},
					},
				});

				result = {
					updated: true,
					created: false,
					tradeSetup: {
						id: updatedSetup.id,
						token: tradeObj.token,
						direction: tradeObj.direction,
						entryPrice: entryPrice,
						stopLoss: stopLoss,
						takeProfit: takeProfit,
						riskRewardRatio: tradeObj.riskRewardRatio,
						status: tradeObj.status,
					},
				};

				this.logger.success(`Updated trade setup for ${ tradeObj.direction } ${ tradeObj.token }`);
			} else {
				// Create new trade setup
				const tradeSetup = await this.prisma.memoryObject.create({
					data: {
						chatId,
						objectType: 'trade_setup',
						name: setupName,
						data: tradeObj,
						isActive: true,
					},
				});

				result = {
					updated: false,
					created: true,
					tradeSetup: {
						id: tradeSetup.id,
						token: tradeObj.token,
						direction: tradeObj.direction,
						entryPrice: entryPrice,
						stopLoss: stopLoss,
						takeProfit: takeProfit,
						riskRewardRatio: tradeObj.riskRewardRatio,
						status: tradeObj.status,
					},
				};

				this.logger.success(`Created trade setup for ${ tradeObj.direction } ${ tradeObj.token }`);
			}

			this.logger.exit(functionName, result);
			return result;

		} catch(error) {
			this.logger.error(`Failed to upsert trade setup`, error);
			this.logger.exit(functionName, { error: true });
			throw error;
		}
	}

	/**
	 * Creates or updates a market analysis record
	 * @param {number} chatId - The chat ID
	 * @param {Object} analysisData - Market analysis details
	 * @returns {Promise<Object>} Result with created/updated analysis
	 */
	async upsertMarketAnalysis(chatId, analysisData) {
		const functionName = 'upsertMarketAnalysis';
		this.logger.entry(functionName, { chatId, analysisData });

		// Validate required fields
		if(!analysisData.title || !analysisData.content) {
			this.logger.error('Invalid analysis data', { analysisData });
			throw new Error('Market analysis requires title and content');
		}

		// Ensure tokens is an array
		let tokensList = [];
		if(analysisData.tokens) {
			if(typeof analysisData.tokens === 'string') {
				tokensList = analysisData.tokens.split(',').map(t => t.trim()).filter(t => t);
			} else if(Array.isArray(analysisData.tokens)) {
				tokensList = analysisData.tokens;
			}
		}

		// Create analysis object
		const analysisObj = {
			objectType: 'market_analysis',
			title: analysisData.title,
			content: analysisData.content,
			summary: analysisData.summary || '',
			tokens: tokensList,
			marketCondition: analysisData.marketCondition || 'neutral', // bullish, bearish, neutral
			timeframe: analysisData.timeframe || 'short-term',
			sentimentScore: analysisData.sentimentScore || 0, // -10 to 10
			keyFactors: analysisData.keyFactors || [],
			recommendations: analysisData.recommendations || [],
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};

		try {
			// Check if an analysis with this title already exists
			const existingAnalysis = await this.prisma.memoryObject.findFirst({
				where: {
					chatId,
					objectType: 'market_analysis',
					name: analysisData.title,
					isActive: true,
				},
			});

			let result;

			if(existingAnalysis) {
				// Update existing analysis
				const updatedAnalysis = await this.prisma.memoryObject.update({
					where: { id: existingAnalysis.id },
					data: {
						data: {
							...existingAnalysis.data,
							...analysisObj,
							createdAt: existingAnalysis.data.createdAt, // Keep original creation date
							updatedAt: new Date().toISOString(),
						},
					},
				});

				result = {
					updated: true,
					created: false,
					analysis: {
						id: updatedAnalysis.id,
						title: analysisObj.title,
						marketCondition: analysisObj.marketCondition,
						timeframe: analysisObj.timeframe,
						tokens: tokensList,
					},
				};

				this.logger.success(`Updated market analysis '${ analysisObj.title }'`);
			} else {
				// Create new analysis
				const analysis = await this.prisma.memoryObject.create({
					data: {
						chatId,
						objectType: 'market_analysis',
						name: analysisObj.title,
						data: analysisObj,
						isActive: true,
					},
				});

				result = {
					created: true,
					updated: false,
					analysis: {
						id: analysis.id,
						title: analysisObj.title,
						marketCondition: analysisObj.marketCondition,
						timeframe: analysisObj.timeframe,
						tokens: tokensList,
					},
				};

				this.logger.success(`Created market analysis '${ analysisObj.title }'`);
			}

			this.logger.exit(functionName, result);
			return result;
		} catch(error) {
			this.logger.error(`Failed to upsert market analysis`, error);
			this.logger.exit(functionName, { error: true });
			throw error;
		}
	}

	/**
	 * Helper function to parse token document strings from Chroma search results
	 * @param {string} documentString - Document string from Chroma search containing token info
	 * @returns {Object} Parsed token information
	 */
	parseTokenDocumentString(documentString) {
		try {
			// Extract token details using regex
			const nameMatch = documentString.match(/Token Name: ([^.]+)\./);
			const symbolMatch = documentString.match(/Symbol: ([^.]+)\./);
			const addressMatch = documentString.match(/Address: ([^.]+)\./);

			return {
				name: nameMatch ? nameMatch[1].trim() : 'Unknown',
				symbol: symbolMatch ? symbolMatch[1].trim() : 'Unknown',
				address: addressMatch ? addressMatch[1].trim() : null,
			};
		} catch(error) {
			console.error('Error parsing token document string:', error);
			return {
				name: 'Parse Error',
				symbol: 'Unknown',
				address: null,
			};
		}
	}

	/**
	 * Action: Resolve token addresses from user messages
	 * @param {object} args - Arguments { query, limit }
	 * @returns {Promise<object>} Result with resolved tokens
	 */
	async actionResolveTokenAddresses(args) {
		const functionName = 'actionResolveTokenAddresses';
		this.logger.entry(functionName, { args });
		const { query, limit = 3 } = args;

		if(!query) {
			this.logger.error('Query is required.', { args });
			throw new Error('Query is required for resolve_token_addresses action');
		}

		try {
			// 1. Get tokens from database (for potential matches)
			this.logger.info('Fetching tokens from database...');
			const tokens = await this.prisma.token.findMany({
				where: {
					AND: [
						{ NOT: { name: null } },
						{ NOT: { symbol: null } },
					],
				},
			});
			this.logger.info(`Found ${ tokens.length } tokens in database.`);

			// 2. Initialize embedding function - this is crucial
			this.logger.info('Initializing OpenAI embedding function...');
			if(!process.env.OPENAI_API_KEY) {
				this.logger.error('OpenAI API Key is missing.');
				throw new Error('Missing OpenAI API Key configuration.');
			}
			const embeddingFunction = new OpenAIEmbeddingFunction({
				openai_api_key: process.env.OPENAI_API_KEY,
				openai_model: ConversationService.TOKEN_EMBEDDING_MODEL,
			});
			this.logger.info(`Embedding function created for model: ${ ConversationService.TOKEN_EMBEDDING_MODEL }.`);

			// 3. Get the collection WITH the embedding function
			this.logger.info('Getting Chroma collection with embedding function...');
			const collectionName = 'token_resolution'; // Match what's in your script

			let collection;
			try {
				collection = await ChromaService.client.getCollection({
					name: collectionName,
					embeddingFunction: embeddingFunction, // This is key to fix the error
				});
				this.logger.info(`Successfully connected to Chroma collection: ${ collection.name }`);
			} catch(error) {
				this.logger.error(`Failed to get Chroma collection: ${ error.message }`, error);
				// Fall back to text-only matching
				const potentialMatches = tokens
					.filter(token =>
						query.toLowerCase().includes(token.symbol?.toLowerCase()) ||
						query.toLowerCase().includes(token.name?.toLowerCase()),
					)
					.slice(0, 5)
					.map(token => ({
						token_name: token.name,
						token_symbol: token.symbol,
						token_address: token.address,
					}));

				return {
					original_query: query,
					semantic_query: query,
					resolved_tokens: [],
					potential_tokens: potentialMatches,
				};
			}

			// 4. Generate semantic query with AI
			this.logger.info('Generating optimized semantic query...');
			const queryGenPrompt = `
I need a semantic search query to find cryptocurrency tokens mentioned in the following text:
"${ query }"

Extract ONLY the token names, symbols or related descriptions. Focus on token identification terms.
DO NOT include explanatory text, conjunctions or any other words that aren't directly related to the token.
Respond with ONLY the search query text, no other explanations.

Example 1:
User input: "What's the price of Solana right now?"
Response: Solana SOL

Example 2: 
User input: "Compare the performance of Bitcoin and Ethereum"
Response: Bitcoin BTC Ethereum ETH
`;

			const queryGenResponse = await AIService.sendMessage({
				model: this.defaultModel,
				system: 'You are a search query generator. Extract only cryptocurrency token identifiers from user text.',
				prompt: queryGenPrompt,
				temperature: 0.2,
			});

			let semanticQuery = '';
			if(queryGenResponse.choices && queryGenResponse.choices[0]?.message?.content) {
				semanticQuery = queryGenResponse.choices[0].message.content.trim();
				this.logger.info(`Generated semantic query: "${ semanticQuery }"`);
			} else {
				semanticQuery = query;
				this.logger.warn(`Failed to generate semantic query, using original: "${ semanticQuery }"`);
			}

			// 5. Perform the semantic search directly on the collection with embedding function
			this.logger.info(`Performing semantic search with query: "${ semanticQuery }"`);
			const searchResults = await collection.query({
				queryTexts: [ semanticQuery ],
				nResults: parseInt(limit),
				include: [ 'documents', 'metadatas', 'distances' ],
			});

			// 6. Process search results

			// Modify actionResolveTokenAddresses to return a cleaner structure
			const result = {
				resolvedTokens: searchResults.documents[0].map(doc => {
					// Parse the document string to extract token data
					const tokenInfo = this.parseTokenDocumentString(doc);
					return {
						token_symbol: tokenInfo.symbol,
						token_name: tokenInfo.name,
						token_address: tokenInfo.address,
					};
				}),
				query: semanticQuery,
			};

			this.logger.info(`Token results: ${ JSON.stringify(result, null, 2) }`);
			this.logger.exit(functionName);
			return result;
		} catch(error) {
			this.logger.error(`Failed in ${ functionName }`, error);
			this.logger.exit(functionName, { error: true });
			throw new Error(`Failed to resolve token addresses: ${ error.message }`);
		}
	}

	// Helper method to find potential token matches by simple text matching
	findPotentialTokenMatches(tokens, query, alreadyFound = []) {
		return tokens
			.filter(token => {
				// Don't include tokens already in main results
				return !alreadyFound.some(r => r.token_address === token.address) &&
					(query.toLowerCase().includes(token.symbol?.toLowerCase()) ||
						query.toLowerCase().includes(token.name?.toLowerCase()));
			})
			.slice(0, 5) // Limit to 5 potential matches
			.map(token => ({
				token_name: token.name,
				token_symbol: token.symbol,
				token_address: token.address,
			}));
	}

	reportProgress(stage = '', detail = '', object = null, progressCallback) {
		if(typeof progressCallback === 'function') {
			try {
				progressCallback(stage, detail);
			} catch(e) {
				this.logger.warn(`Error in progress callback at stage "${ stage }":`, e);
			}
		}
	};

	/**
	 * Formats memory-only tools for the memory consultation phase
	 * @returns {Array} Memory-only tools
	 */
	formatMemoryOnlyTools() {
		const functionName = 'formatMemoryOnlyTools';
		this.logger.entry(functionName);

		try {
			// Select only memory-related tools
			const memoryToolNames = [ 'retrieve_memory_items', 'retrieve_memory_objects', 'semantic_query' ];

			const memoryTools = this.availableActions.actions
				.filter(action => action.isActive && memoryToolNames.includes(action.name))
				.map(action => ({
					type: 'function',
					function: {
						name: action.name,
						description: action.description,
						parameters: action.parameters,
					},
				}));

			this.logger.success(`Formatted ${ memoryTools.length } memory-only tools`);
			this.logger.exit(functionName, { toolCount: memoryTools.length });
			return memoryTools;
		} catch(error) {
			this.logger.error(`Error in ${ functionName }`, error);
			this.logger.exit(functionName, { error: true });
			return [];
		}
	}

	/**
	 * Action: Retrieve Memory Items
	 */
	async actionRetrieveMemoryItems(chatId, args) {
		const functionName = 'actionRetrieveMemoryItems';
		this.logger.entry(functionName, { chatId, args });
		const { query, exact_match = false } = args;

		if(!query) {
			this.logger.error('Query parameter is required', { args });
			throw new Error('Query parameter is required for retrieve_memory_items action');
		}

		try {
			this.logger.info(`Retrieving memory items for query: "${ query }" (exact match: ${ exact_match })`);

			// Build where clause based on query and exact_match
			let whereClause = { chatId };

			if(query !== '*') {
				if(exact_match) {
					whereClause.key = query;
				} else {
					// Case-insensitive partial match
					whereClause.key = { contains: query };
				}
			}

			// Query the database
			const memoryItems = await this.prisma.memoryItem.findMany({
				where: whereClause,
				orderBy: { key: 'asc' },
			});

			this.logger.info(`Found ${ memoryItems.length } memory items`);

			// Format items with proper type conversion
			const formattedItems = memoryItems.map(item => {
				let parsedValue = item.value;

				// Convert value based on type
				try {
					if(item.type === 'json') {
						parsedValue = JSON.parse(item.value);
					} else if(item.type === 'number') {
						parsedValue = parseFloat(item.value);
						if(isNaN(parsedValue)) parsedValue = 0;
					} else if(item.type === 'boolean') {
						parsedValue = item.value.toLowerCase() === 'true';
					}
				} catch(e) {
					this.logger.warn(`Failed to parse value for item ${ item.key }`, e);
					parsedValue = item.value; // Fall back to string
				}

				return {
					key: item.key,
					value: parsedValue,
					type: item.type,
					source: item.source,
					created: item.created.toISOString(),
				};
			});

			// Build and return result
			const result = {
				query,
				exact_match,
				count: formattedItems.length,
				items: formattedItems,
			};

			this.logger.success(`Retrieved ${ formattedItems.length } memory items`);
			this.logger.exit(functionName, { count: formattedItems.length });
			return result;

		} catch(error) {
			this.logger.error(`Failed in ${ functionName }`, error);
			this.logger.exit(functionName, { error: true });
			throw new Error(`Failed to retrieve memory items: ${ error.message }`);
		}
	}

	/**
	 * Action: Retrieve Memory Objects
	 */
	async actionRetrieveMemoryObjects(chatId, args) {
		const functionName = 'actionRetrieveMemoryObjects';
		this.logger.entry(functionName, { chatId, args });
		const { type = '*', name } = args;

		try {
			this.logger.info(`Retrieving memory objects of type: "${ type }" ${ name ? `with name: "${ name }"` : '' }`);

			// Build where clause
			let whereClause = {
				chatId,
				isActive: true,
			};

			// Add type filter if not wildcard
			if(type !== '*') {
				whereClause.objectType = type;
			}

			// Add name filter if provided
			if(name) {
				whereClause.name = { contains: name };
			}

			// Query the database
			const memoryObjects = await this.prisma.memoryObject.findMany({
				where: whereClause,
				orderBy: { created: 'desc' },
			});

			this.logger.info(`Found ${ memoryObjects.length } memory objects`);

			// Format objects for response
			const formattedObjects = memoryObjects.map(obj => ({
				id: obj.id,
				type: obj.objectType,
				name: obj.name,
				data: obj.data,
				created: obj.created.toISOString(),
			}));

			// Build and return result
			const result = {
				type: type === '*' ? 'all' : type,
				name_filter: name || null,
				count: formattedObjects.length,
				objects: formattedObjects,
			};

			this.logger.success(`Retrieved ${ formattedObjects.length } memory objects`);
			this.logger.exit(functionName, { count: formattedObjects.length });
			return result;

		} catch(error) {
			this.logger.error(`Failed in ${ functionName }`, error);
			this.logger.exit(functionName, { error: true });
			throw new Error(`Failed to retrieve memory objects: ${ error.message }`);
		}
	}

	/**
	 * Processes the memory consultation phase with memory-only tools
	 * @param {number} userId - User ID
	 * @param {number} chatId - Chat ID
	 * @param {string} message - User message
	 * @param {Object} basicContext - Basic context with recent messages
	 * @returns {Promise<Object>} Memory consultation results
	 */
	async processMemoryconsultation(userId, chatId, message, basicContext) {
		const functionName = 'processMemoryconsultation';
		this.logger.entry(functionName, { chatId, userId });

		try {
			// 1. Prepare memory-only tools
			const memoryTools = this.formatMemoryOnlyTools();
			this.logger.info('Prepared memory-only tools', { toolCount: memoryTools.length });

			// 2. Build memory system prompt
			const memorySystemPrompt = `You are an AI assistant specialized in memory recall.
Your task is to determine if the user is asking about:
1. Specific information previously stored about them (preferences, settings, etc.)
2. Previously created strategies or objects
3. Information from past conversations

ONLY use the provided memory tools if you're CERTAIN the user is requesting memory-related information.
If you're unsure or the user is asking about blockchain/token data, DO NOT call any tools.

You have access to these memory tools:
- retrieve_memory_items: Get specific memory items like user preferences
- retrieve_memory_objects: Get stored objects like trading strategies
- semantic_query: Search previous conversations semantically

Choose the most appropriate tool(s) for the user's request.`;

			// 3. Send AI request with memory tools only
			this.logger.info('Sending memory consultation request to AI...');
			const memoryResponse = await AIService.sendMessage({
				model: this.defaultModel,
				system: memorySystemPrompt,
				prompt: message,
				history: this.formatMessagesForAI(basicContext.recentMessages),
				temperature: 0.4,
				tools: memoryTools,
				toolChoice: 'auto', // Let AI decide whether to use tools
			});

			this.logger.info('Received memory consultation response');

			// 4. Process memory tool calls if any
			let memoryResults = {
				memoryItems: [],
				memoryObjects: [],
				semanticResults: null,
			};

			if(memoryResponse.choices && memoryResponse.choices[0]?.message?.tool_calls) {
				const toolCalls = memoryResponse.choices[0].message.tool_calls;
				this.logger.info(`Processing ${ toolCalls.length } memory tool calls`);

				// Create placeholder message to associate with tool calls
				const placeholderMsg = await this.saveMessage(chatId, userId, '...', 'assistant');

				// Execute memory tools
				const memoryActions = await this.executeToolCalls(toolCalls, chatId, userId, placeholderMsg.id);

				// Extract results by tool type
				for(const action of memoryActions) {
					if(action.name === 'retrieve_memory_items' && action.result?.success) {
						memoryResults.memoryItems = action.result.data?.items || [];
					} else if(action.name === 'retrieve_memory_objects' && action.result?.success) {
						memoryResults.memoryObjects = action.result.data?.objects || [];
					} else if(action.name === 'semantic_query' && action.result?.success) {
						memoryResults.semanticResults = action.result.data;
					}
				}

				// Delete the placeholder message
				await this.prisma.message.delete({ where: { id: placeholderMsg.id } });
				this.logger.info('Deleted memory consultation placeholder message');
			}

			this.logger.success('Memory consultation completed successfully');
			this.logger.exit(functionName, {
				memoryItemsCount: memoryResults.memoryItems.length,
				memoryObjectsCount: memoryResults.memoryObjects.length,
				hasSemanticResults: !!memoryResults.semanticResults,
			});

			return memoryResults;

		} catch(error) {
			this.logger.error(`Error in ${ functionName }`, error);
			this.logger.exit(functionName, { error: true });
			// Don't throw - return empty results to continue the flow
			return {
				memoryItems: [],
				memoryObjects: [],
				semanticResults: null,
				error: error.message,
			};
		}
	}

	/**
	 * Starts or continues a conversation with the AI, handling tool calls and final synthesis.
	 * @param {number} userId - User ID
	 * @param {number|null} chatId - Conversation ID (null for new)
	 * @param {string} message - User message
	 * @param {number|null} sessionId - Session ID (for Telegram)
	 * @param {Function|null} progressCallback - Optional callback for progress updates
	 * @returns {Promise<Object>} Response including chat, messages, actions, and structured data.
	 */
	async sendMessage(userId, chatId, message, sessionId = null, progressCallback = null) {
		const functionName = 'sendMessage';
		this.logger.entry(functionName, { userId, chatId, message: message.substring(0, 50) + '...', sessionId });

		// Helper function to report progress if callback provided
		try {
			// --- 1. Setup and User Message ---
			this.logger.info('Step 1: Setup and User Message');
			this.reportProgress('setup', 'Initializing conversation');

			// Use the existing method to get or create the chat
			const chatInfo = await this.getOrCreateChat(userId, chatId, sessionId);
			const currentChatId = chatInfo.id;
			const chat = await this.prisma.chat.findUnique({ where: { id: currentChatId } });
			this.logger.info('Chat retrieved/created:', { chatId: currentChatId, new: !chatId });

			const userMessage = await this.saveMessage(currentChatId, userId, message, 'user');
			this.logger.info('User message saved:', { messageId: userMessage.id });

			// Basic context for preliminary phases
			const basicContext = await this.buildBasicContext(currentChatId);
			this.logger.info('Basic context built for preliminary phases');
			/// basic context is
			this.logger.info('basicContext is: ', basicContext);
			// --- 2. Memory Consultation Phase ---
			this.reportProgress('memory_consultation', 'Checking memory and history');
			// Process with memory tools only
			const memoryResults = await this.processMemoryconsultation(
				userId, currentChatId, message, basicContext,
			);
			this.logger.info('Memory consultation completed', {
				memoryItemsFound: memoryResults?.memoryItemsFound || {},
				memoryObjectsFound: memoryResults.memoryObjects?.length || {},
			});

			// --- 3. Token Resolution Phase ---
			this.logger.info('Step 3: Token Resolution Phase');
			this.reportProgress('token_resolution', 'Identifying token references');

			// Process with token resolution tool only
			const tokenResults = await this.processTokenResolution(
				userId, currentChatId, message, basicContext,
			);
			this.logger.info('Token resolution completed', {
				resolvedTokensCount: tokenResults || {},
			});

			/// print the full token resolution context
			this.logger.info('Token resolution context tokenResults:', tokenResults);

			// --- 4. Build Full Context with Results ---
			this.logger.info('Step 4: Building Enhanced Context');

			const enhancedContext = await this.buildEnhancedContext(
				currentChatId, userId, memoryResults, tokenResults,
			);

			this.logger.info('==============================================================================');
			this.logger.info('Enhanced context built with memory and token data:', enhancedContext);
			this.logger.info('==============================================================================');
			// --- 5. Main AI Consultation (with all Vybe tools) ---
			this.logger.info('Step 5: Main AI Consultation');
			this.reportProgress('main_consultation', 'Processing your request');

			const firstAiRequest = this.buildAIRequest(enhancedContext, message);
			this.logger.info(`Built AI request for model: ${ firstAiRequest.model }`);

			const firstAiResponse = await AIService.sendMessage(firstAiRequest);
			this.logger.info('Received AI response.');

			// --- 6. Process Initial Response ---
			this.logger.info('Step 6: Process Initial Response');

			let initialContent = '';
			let toolCalls = null;
			this.logger.info('==============================================================================');
			this.logger.info('===========================FIRST AI RESPONSE==================================');
			this.logger.info('Raw AI Response:', firstAiResponse);
			this.logger.info('==============================================================================');
			if(firstAiResponse.choices && firstAiResponse.choices[0]?.message) {
				const responseMessage = firstAiResponse.choices[0].message;
				initialContent = responseMessage.content || '';
				toolCalls = responseMessage.tool_calls;
				this.logger.info(`Initial content present: ${ !!initialContent }, Tool calls present: ${ !!toolCalls?.length }`);
				if(toolCalls) {
					this.logger.info('Tool calls requested:', toolCalls.map(t => t.function.name));
				}
			} else {
				this.logger.warn('AI response structure unexpected or empty in first call.');
				initialContent = 'I encountered an issue communicating with the AI. Please try again.';
			}

			let executedActions = [];
			let finalContent = initialContent;
			let structuredData = null;
			let assistantMessage;

			// --- 7. Handle Tool Calls (if any) ---
			if(toolCalls && toolCalls.length > 0) {
				this.logger.info(`Step 7: Handle ${ toolCalls.length } Tool Calls`);
				this.reportProgress('executing_tools', `Running ${ toolCalls.length } actions`);

				// 7a. Save Placeholder Message
				this.logger.info('Saving placeholder assistant message...');
				const placeholderMessage = await this.saveMessage(currentChatId, userId, '...', 'assistant');
				this.logger.info('Placeholder message saved:', { messageId: placeholderMessage.id });

				// 7b. Execute Tools
				this.logger.info('Executing tool calls...');
				executedActions = await this.executeToolCalls(toolCalls, currentChatId, userId, placeholderMessage.id);
				this.logger.info('Respuesta de ejecutar toolcalls:', executedActions);

				// --- 8. Second AI Call (Synthesis with JSON Mode) ---
				this.logger.info('Step 8: Synthesis');
				this.reportProgress('synthesis', 'Preparing your answer');

				const synthesisSystemPrompt = `You are an AI assistant processing the results of tool executions.
Your task is to analyze these results and generate a response ONLY in a valid JSON object format.
This JSON object MUST contain exactly THREE keys:
1.  "reply": A string containing your user-friendly, natural language response summarizing a very useful response for the user, the key results..
2.  "actionData": An object containing ALL relevant structured data from SUCCESSFUL actions, MAINTAINING ALL PROPERTIES from the original result, including ALL token recommendations.
3.  "source": An object containing information about where the data comes from, e.g. {"api": "Vybe Network", "endpoint": "recommend_tokens", "timestamp": "${ new Date().toISOString() }"}.

IMPORTANT LANGUAGE INSTRUCTION: Always respond in the SAME LANGUAGE that the user's query was written in. If the user writes in Spanish, your "reply" should be in Spanish. If the user writes in English, your "reply" should be in English, etc. Be sure to translate all the information while keeping the technical terms clear.

Example JSON for a successful 'recommend_tokens' action:
{
  "reply": "Based on data from Vybe Network API, I recommend these tokens: X, Y, Z with market caps of $A, $B, $C respectively.",
  "actionData": { /* COMPLETE, UNMODIFIED token recommendations data from API */ },
  "source": {"api": "Vybe Network", "endpoint": "recommend_tokens", "timestamp": "2025-04-22T05:47:01.484Z"}
}

IMPORTANT: NEVER truncate, summarize or modify the action data. Include ALL received recommendations with ALL fields.
IF the structured data has data from the Vybe Network mention that data comes from Vybe Network API in the reply if not do not mention it.
Respond ONLY with the valid JSON object and nothing else.`;

				// Build the main prompt content with the action results
				let synthesisPromptContent = `Context: The user previously interacted. The user's last message that triggered the tool call was: "${ message }"\n`;
				synthesisPromptContent += `Results of the executed actions:\n`;
				executedActions.forEach(action => {
					synthesisPromptContent += `- Action: ${ action.name }\n  Result: ${ JSON.stringify(action.result) }\n`;
				});

				this.logger.info('Built synthesis prompts for JSON mode.');

				// 8b. Make the second AI call using the defined prompts
				this.logger.info('Sending synthesis request to AI (JSON Mode)...');
				const synthesisResponse = await AIService.sendMessage({
					model: this.defaultModel,
					system: synthesisSystemPrompt,
					prompt: synthesisPromptContent,
					temperature: 0.4,
					responseFormat: { type: 'json_object' },
				});
				this.logger.info('Raw Synthesis AI Response:', synthesisResponse);

				// 8c. Process Synthesis Response
				this.logger.info('Processing synthesis response.');
				if(synthesisResponse.choices && synthesisResponse.choices[0]?.message?.content) {
					try {
						const rawJson = synthesisResponse.choices[0].message.content;
						const parsedJson = JSON.parse(rawJson);

						// Validate expected structure
						if(typeof parsedJson.reply !== 'string' || typeof parsedJson.actionData === 'undefined') {
							throw new Error('AI JSON response is missing required keys (\'reply\' (string) or \'actionData\').');
						}

						finalContent = parsedJson.reply;
						structuredData = parsedJson.actionData;
						this.logger.success('Successfully parsed synthesis JSON.');
						this.logger.info('Parsed structured data:', structuredData);

					} catch(e) {
						this.logger.error('Failed to parse JSON from synthesis step or JSON structure invalid', e,
							{ rawResponse: synthesisResponse.choices[0].message.content });
						finalContent = initialContent || 'I processed the actions, but encountered an issue formatting the final response. Please let me know if you need specific details.';
						structuredData = {
							error: 'Failed to parse synthesis JSON or structure invalid',
							raw_response: synthesisResponse.choices[0].message.content,
						};
					}
				} else {
					this.logger.error('No content found in synthesis response from AI.');
					finalContent = initialContent || 'I executed the actions, but the final summary generation failed.';
					structuredData = { error: 'No content in AI synthesis response' };
				}

				// 8d. Update the placeholder message with the synthesized content
				this.logger.info('Updating placeholder message with final synthesized content.');
				this.reportProgress('finalizing', 'Completing your answer');
				assistantMessage = await this.updateMessageContent(placeholderMessage.id, finalContent);
				this.logger.info('Assistant message updated.', { messageId: assistantMessage.id });

			} else {
				// --- No Tool Calls: Save Initial Content Directly ---
				this.logger.info('No Tool Calls - Saving initial content directly.');
				this.reportProgress('finalizing', 'Completing your answer');

				// Ensure finalContent uses initialContent if it exists and wasn't overwritten by errors
				if(!finalContent && initialContent) {
					finalContent = initialContent;
				} else if(!finalContent) {
					this.logger.warn('AI provided no initial content and no tool calls.');
					finalContent = 'I\'m sorry, I couldn\'t generate a response for that.';
				}

				assistantMessage = await this.saveMessage(currentChatId, userId, finalContent, 'assistant');
				this.logger.info('Saved final assistant message directly.', { messageId: assistantMessage.id });
			}

			// --- 9. Final Steps & Return ---
			this.logger.info('Step 9: Final Steps');

			// Update chat stats after saving the final message
			await this.updateChatStats(currentChatId);
			this.logger.info('Chat stats updated.');

			// Optional: Semantic indexing logic
			if(chat && chat.messageCount % 10 === 0) {
				this.logger.info(`Chat reached ${ chat.messageCount } messages, attempting semantic indexing.`);
				try {
					await this.createSearchCollection(currentChatId);
				} catch(error) {
					this.logger.error(`Failed during optional semantic indexing for chat ${ currentChatId }`, error);
				}
			}

			// Fetch all memory items and objects for the response
			this.logger.info(`Fetching all memory items and objects for chat ${ currentChatId }...`);
			let allMemoryItems = [];
			let allMemoryObjects = [];

			try {
				allMemoryItems = await this.prisma.memoryItem.findMany({
					where: { chatId: currentChatId },
					orderBy: { key: 'asc' },
				});

				allMemoryObjects = await this.prisma.memoryObject.findMany({
					where: { chatId: currentChatId },
					orderBy: { created: 'asc' },
				});

				this.logger.info(`Retrieved ${ allMemoryItems.length } memory items and ${ allMemoryObjects.length } memory objects.`);
			} catch(memoryError) {
				this.logger.error(`Failed to fetch memory items/objects for chat ${ currentChatId }`, memoryError);
			}

			// Prepare the final return value
			const returnValue = {
				chat: await this.prisma.chat.findUnique({ where: { id: currentChatId } }),
				userMessage: userMessage,
				assistantMessage: assistantMessage,
				executedActions: executedActions,
				structuredData: structuredData,
				memoryItems: allMemoryItems,
				memoryObjects: allMemoryObjects,
			};

			this.reportProgress('complete', 'Response ready');
			this.logger.success(`Successfully completed ${ functionName }.`);
			this.logger.exit(functionName, { chatId: currentChatId, assistantMessageId: assistantMessage.id });

			return returnValue;

		} catch(error) {
			this.logger.error(`Critical error in ${ functionName }`, error);
			this.reportProgress('error', error.message);

			this.logger.exit(functionName, {
				error: true,
				errorMessage: error.message,
				userId,
				chatId,
				sessionId,
			});

			throw new Error(`Error in sendMessage: ${ error.message }`);
		}
	}

	/**
	 * Processes the token resolution phase with token resolution tool only
	 * @param {number} userId - User ID
	 * @param {number} chatId - Chat ID
	 * @param {string} message - User message
	 * @param {Object} basicContext - Basic context with recent messages
	 * @returns {Promise<Object>} Token resolution results
	 */
	async processTokenResolution(userId, chatId, message, basicContext) {
		const functionName = 'processTokenResolution';
		this.logger.entry(functionName, { chatId, userId });

		try {
			// 1. Preparar herramienta de resolución de tokens solamente
			const tokenTools = this.formatTokenResolutionTool();
			this.logger.info('Prepared token resolution tool');

			// 2. Construir system prompt para resolución de tokens
			const tokenSystemPrompt = `You are an AI assistant specialized in identifying cryptocurrency tokens.
Your task is to identify any token symbols or names mentioned in the user's message.

Only use the resolve_token_addresses tool if you detect:
1. Specific token symbols (like SOL, BTC, ETH, JUP, BONK)
2. Token names (like Solana, Bitcoin, Ethereum)
3. References to tokens that need to be resolved to addresses

Examples when to use the tool:
- "What's the price of SOL today?"
- "Tell me about Jupiter token"
- "Compare BONK and JUP performance"

DO NOT use the tool if:
- The message contains no token references
- The user is asking about general topics or the platform itself

This step is crucial for the main assistant to use correct token addresses.`;

			// 3. Enviar solicitud a la IA con herramienta de resolución de tokens solamente
			this.logger.info('Sending token resolution request to AI...');
			const tokenResponse = await AIService.sendMessage({
				model: this.defaultModel,
				system: tokenSystemPrompt,
				prompt: message,
				history: this.formatMessagesForAI(basicContext.recentMessages),
				temperature: 0.4,
				tools: tokenTools,
				toolChoice: 'auto', // Dejar que la IA decida si usar la herramienta
			});

			this.logger.info('Received token resolution response');

			// 4. Procesar llamadas a herramientas de resolución de tokens si las hay
			let tokenResults = [];
			if(tokenResponse.choices && tokenResponse.choices[0]?.message?.tool_calls) {
				const toolCalls = tokenResponse.choices[0].message.tool_calls;
				this.logger.info(`Processing ${ toolCalls.length } token resolution tool calls`);

				// Crear mensaje placeholder para asociar con las llamadas a herramientas
				const placeholderMsg = await this.saveMessage(chatId, userId, '...', 'assistant');

				// Ejecutar herramienta de resolución de tokens
				const tokenActions = await this.executeToolCalls(toolCalls, chatId, userId, placeholderMsg.id);
				this.logger.info('Token resolution tool calls executed.', tokenActions);

				// Extraer resultados de resolución de tokens y formatearlos adecuadamente
				for(const action of tokenActions) {
					if(action.name === 'resolve_token_addresses' && action.result?.success) {
						this.logger.info('Token resolution action result:', action.result);
						tokenResults.push(tokenActions);
					}
				}

				// Eliminar el mensaje placeholder
				await this.prisma.message.delete({ where: { id: placeholderMsg.id } });
				this.logger.info('Deleted token resolution placeholder message');
			}

			this.logger.info('Token resolution completed', {
				resolvedTokensCount: tokenResults,
			});

			this.logger.info('Token resolution context tokenResults:', tokenResults);
			this.logger.success('Token resolution completed successfully');
			this.logger.exit(functionName);

			return tokenResults;
		} catch(error) {
			this.logger.error(`Error in ${ functionName }`, error);
			this.logger.exit(functionName, { error: true });
			// No lanzar el error - devolver resultados vacíos para continuar el flujo
			return {
				resolvedTokens: [],
				potentialTokens: [],
				error: error.message,
			};
		}
	}

	/**
	 * Builds basic context with just recent messages for preliminary phases
	 * @param {number} chatId - Chat ID
	 * @returns {Promise<Object>} Basic context
	 */
	async buildBasicContext(chatId) {
		const functionName = 'buildBasicContext';
		this.logger.entry(functionName, { chatId });

		try {
			// Just get recent messages - minimal context for preliminary phases
			const recentMessages = await this.prisma.message.findMany({
				where: {
					chatId: chatId,
					status: 'Active',
				},
				orderBy: { created: 'desc' },
				take: this.memoryContextSize,
			});

			this.logger.info(`Retrieved ${ recentMessages.length } recent messages for basic context`);

			const context = {
				recentMessages: recentMessages.reverse(), // Chronological order
			};

			this.logger.success('Successfully built basic context');
			this.logger.exit(functionName, { messageCount: context.recentMessages.length });
			return context;
		} catch(error) {
			this.logger.error(`Error in ${ functionName }`, error);
			this.logger.exit(functionName, { error: true });
			throw new Error(`Error building basic context: ${ error.message }`);
		}
	}

	/**
	 * Builds enhanced context including memory and token resolution results
	 * @param {number} chatId - Chat ID
	 * @param {number} userId - User ID
	 * @param {Object} memoryResults - Results from memory consultation phase
	 * @param {Object} tokenResults - Results from token resolution phase
	 * @returns {Promise<Object>} Enhanced context for main AI consultation
	 */
	async buildEnhancedContext(chatId, userId, memoryResults, tokenResults) {
		const functionName = 'buildEnhancedContext';
		this.logger.entry(functionName, { chatId, userId });

		try {
			// Start with the standard conversation context
			const standardContext = await this.buildConversationContext(chatId, userId);

			// Add memory resolution results if available
			if(memoryResults && (
				memoryResults.memoryItems?.length > 0 ||
				memoryResults.memoryObjects?.length > 0 ||
				memoryResults.semanticResults
			)) {
				this.logger.info('Adding memory resolution results to context');
				standardContext.memoryResolution = {
					retrievedItems: memoryResults.memoryItems || [],
					retrievedObjects: memoryResults.memoryObjects || [],
					semanticResults: memoryResults.semanticResults,
				};
			}

			let resolvedTokens = [];

			if(tokenResults && tokenResults.length > 0) {
				// Si es un array de acción, busca los datos resueltos
				if(Array.isArray(tokenResults[0]) && tokenResults[0].length > 0) {
					const tokenAction = tokenResults[0][0];
					if(tokenAction && tokenAction.result && tokenAction.result.data &&
						tokenAction.result.data.resolvedTokens) {
						resolvedTokens = tokenAction.result.data.resolvedTokens;
						this.logger.info('Extracted token results from nested action format',
							{ tokenCount: resolvedTokens.length });
					}
				}
				// Si ya es un array de tokens (el formato esperado)
				else if(Array.isArray(tokenResults) && typeof tokenResults[0] === 'object' &&
					(tokenResults[0].token_address || tokenResults[0].token_symbol)) {
					resolvedTokens = tokenResults;
				}
			}

			if(resolvedTokens.length > 0) {
				this.logger.info('Adding token resolution results to context');
				standardContext.tokenResolution = {
					resolvedTokens: resolvedTokens,
					potentialTokens: [], // Opcional si se implementa
				};
			}

			this.logger.success('Successfully built enhanced context');
			this.logger.exit(functionName, {
				hasMemoryResolution: !!standardContext.memoryResolution,
				hasTokenResolution: !!standardContext.tokenResolution,
			});

			return standardContext;
		} catch(error) {
			this.logger.error(`Error in ${ functionName }`, error);
			this.logger.exit(functionName, { error: true });
			throw new Error(`Error building enhanced context: ${ error.message }`);
		}
	}

	formatTokenResolutionTool() {
		const functionName = 'formatTokenResolutionTool';
		this.logger.entry(functionName);

		try {
			// Select only the token resolution tool
			const tokenAction = this.availableActions.actions
				.find(action => action.isActive && action.name === 'resolve_token_addresses');

			if(!tokenAction) {
				this.logger.warn('Token resolution tool not found in available actions');
				this.logger.exit(functionName, { toolCount: 0 });
				return [];
			}

			const tokenTool = [ {
				type: 'function',
				function: {
					name: tokenAction.name,
					description: tokenAction.description,
					parameters: tokenAction.parameters,
				},
			} ];

			this.logger.success('Formatted token resolution tool');
			this.logger.exit(functionName, { toolCount: 1 });
			return tokenTool;
		} catch(error) {
			this.logger.error(`Error in ${ functionName }`, error);
			this.logger.exit(functionName, { error: true });
			return [];
		}
	}

	/**

	/**
	* Executes tool calls requested by the AI.
	 * @param {Array} toolCalls - The tool_calls array from the AI response.
	 * @param {number} chatId - The ID of the current chat.
	 * @param {number} userId - The ID of the user.
	 * @param {number} assistantMessageId - The ID of the assistant message this call belongs to.
	 * @returns {Promise<Array<Object>>} A promise that resolves to an array of executed action results.
	 */
	async executeToolCalls(toolCalls, chatId, userId, assistantMessageId) {
		const functionName = 'executeToolCalls';
		this.logger.entry(functionName, { toolCallCount: toolCalls?.length, chatId, userId, assistantMessageId });

		if(!toolCalls || toolCalls.length === 0) {
			this.logger.info('No tool calls provided to execute.');
			this.logger.exit(functionName, []);
			return []; // No tools to execute
		}

		let executedActions = [];

		try {
			for(const toolCall of toolCalls) {
				this.logger.info('Processing tool call:', { type: toolCall.type, name: toolCall.function?.name });
				if(toolCall.type === 'function') {
					const functionName = toolCall.function.name;
					let parsedArgs;

					try {
						parsedArgs = JSON.parse(toolCall.function.arguments);
						this.logger.info(`Parsed arguments for ${ functionName }:`, parsedArgs);
					} catch(e) {
						this.logger.error(`Failed to parse arguments for function ${ functionName }`, e, { args: toolCall.function.arguments });
						parsedArgs = {}; // Continue with empty args? Or handle differently?
						// Optionally save a failed action result here
						executedActions.push({
							name: functionName,
							result: { success: false, error: `Failed to parse arguments: ${ e.message }` },
						});
						continue; // Skip execution if args are crucial and failed to parse
					}

					// 1. Save the function call record BEFORE executing
					this.logger.info(`Saving function call record for ${ functionName }...`);
					const functionCallRecord = await this.saveFunctionCall(userId, chatId, functionName, parsedArgs, assistantMessageId); // Will log internally
					this.logger.info(`Function call record saved:`, { id: functionCallRecord.id });

					let actionResult;
					this.logger.info(`Executing action: ${ functionName }`);

					// Handle special case: evaluate_query_intent might trigger semantic_query
					if(functionName === 'evaluate_query_intent') {
						const evaluationResult = await this.executeAction(functionCallRecord.id, functionName, parsedArgs, chatId, userId); // Logs internally
						await this.updateFunctionCallResult(functionCallRecord.id, evaluationResult); // Logs internally
						executedActions.push({ name: functionName, result: evaluationResult });
						this.logger.info(`Result for ${ functionName }:`, evaluationResult);

						// If evaluation suggests semantic search, execute it immediately
						if(evaluationResult.success && evaluationResult.data.needs_semantic_search) {
							this.logger.info('Evaluation suggests semantic search, executing semantic_query...');
							const semanticQueryArgs = {
								query: evaluationResult.data.optimized_query,
								collection: evaluationResult.data.recommended_collection || `chat-${ chatId }`,
								limit: '5',
							};
							const semanticFunctionName = 'semantic_query';
							const semanticFunctionCallRecord = await this.saveFunctionCall(userId, chatId, semanticFunctionName, semanticQueryArgs, assistantMessageId); // Logs internally
							const semanticResult = await this.executeAction(semanticFunctionCallRecord.id, semanticFunctionName, semanticQueryArgs, chatId, userId); // Logs internally
							await this.updateFunctionCallResult(semanticFunctionCallRecord.id, semanticResult); // Logs internally
							executedActions.push({ name: semanticFunctionName, result: semanticResult });
							this.logger.info(`Result for ${ semanticFunctionName }:`, semanticResult);
						}
					} else {
						// Normal action execution
						actionResult = await this.executeAction(functionCallRecord.id, functionName, parsedArgs, chatId, userId); // Logs internally
						this.logger.info('------------------>Executed action result:', actionResult);
						await this.updateFunctionCallResult(functionCallRecord.id, actionResult); // Logs internally
						executedActions.push({ name: functionName, result: actionResult });
						this.logger.info(`Result for ${ functionName }:`, actionResult);
					}
					this.logger.success(`Successfully processed tool call for ${ functionName }.`);
				} else {
					this.logger.warn(`Skipping tool call of unknown type: ${ toolCall.type }`);
				}
			}
			this.logger.success(`Finished executing all tool calls.`);
			this.logger.exit(functionName, executedActions);
			return executedActions;
		} catch(error) {
			this.logger.error(`Error during ${ functionName }`, error);
			// Decide if you want to return partially executed actions or just the error
			this.logger.exit(functionName, { error: true, partialResults: executedActions });
			// Re-throwing might stop the entire sendMessage process, consider if that's desired
			throw error; // Or handle more gracefully
		}
	}

	/**
	 * Gets an existing chat or creates a new one
	 * @param {number} userId
	 * @param {number|null} chatId
	 * @param {number|null} sessionId
	 * @returns {Promise<Object>} Chat object
	 */
	async getOrCreateChat(userId, chatId, sessionId) {
		const functionName = 'getOrCreateChat';
		this.logger.entry(functionName, { userId, chatId, sessionId });
		try {
			if(chatId) {
				this.logger.info('Attempting to find existing chat:', { chatId, userId });
				const existingChat = await this.prisma.chat.findFirst({
					where: { id: chatId, userId: userId, status: 'Active' },
				});
				if(existingChat) {
					this.logger.info('Found existing active chat.', { chatId });
					this.logger.exit(functionName, { chatId: existingChat.id, existed: true });
					return existingChat;
				}
				this.logger.info('Existing chat ID provided but not found or inactive, creating new.', { chatId });
			} else {
				this.logger.info('No chat ID provided, creating new chat.');
			}

			const newChat = await this.prisma.chat.create({
				data: {
					userId: userId,
					sessionId: sessionId,
					title: 'New conversation', // Consider generating a better default title later
					status: 'Active',
					platform: sessionId ? 'telegram' : 'web',
					chatContext: {},
					lastMessageAt: new Date(),
					messageCount: 0,
				},
			});
			this.logger.success('Created new chat.', { chatId: newChat.id });
			this.logger.exit(functionName, { chatId: newChat.id, existed: false });
			return newChat;
		} catch(error) {
			this.logger.error(`Error in ${ functionName }`, error);
			this.logger.exit(functionName, { error: true });
			throw new Error(`Error getting or creating chat: ${ error.message }`);
		}
	}

	/**
	 * Saves a message to the database
	 * @param {number} chatId
	 * @param {number} userId
	 * @param {string} text
	 * @param {string} role
	 * @returns {Promise<Object>} Saved message
	 */
	async saveMessage(chatId, userId, text, role) {
		const functionName = 'saveMessage';
		// Log truncated text
		const logText = text.length > 100 ? text.substring(0, 97) + '...' : text;
		this.logger.entry(functionName, { chatId, userId, role, text: logText });
		try {
			const estimatedTokens = this.estimateTokens(text); // Logs internally
			this.logger.info(`Estimated tokens: ${ estimatedTokens }`);
			const message = await this.prisma.message.create({
				data: {
					chatId, userId, text, role, messageType: 'text', status: 'Active', tokens: estimatedTokens,
				},
			});
			this.logger.success('Message saved successfully.', { messageId: message.id, role: message.role });
			this.logger.exit(functionName, { messageId: message.id });
			return message;
		} catch(error) {
			this.logger.error(`Error in ${ functionName }`, error);
			this.logger.exit(functionName, { error: true });
			throw new Error(`Error saving message: ${ error.message }`);
		}
	}

	/**
	 * Estimates the number of tokens in a text
	 * @param {string} text
	 * @returns {number} Approximate number of tokens
	 */
	estimateTokens(text) {
		// Not logging entry/exit for this simple utility, but could add debug log if needed
		// this.logger.info('Estimating tokens for text length:', text.length);
		// Simple implementation - in production use tiktoken or another more accurate library
		if(!text) return 0;
		const estimate = Math.ceil(text.length / 4);
		// this.logger.info('Token estimate:', estimate);
		return estimate;
	}

	/**
	 * Builds the conversation context including previous messages and memory
	 * @param {number} chatId
	 * @param {number} userId
	 * @returns {Promise<Object>} Conversation context
	 */
	async buildConversationContext(chatId, userId) {
		const functionName = 'buildConversationContext';
		this.logger.entry(functionName, { chatId, userId });
		try {
			// 1. Get recent messages
			this.logger.info(`Workspaceing last ${ this.memoryContextSize } messages.`);
			const recentMessages = await this.prisma.message.findMany({
				where: { chatId: chatId, status: 'Active' },
				orderBy: { created: 'desc' },
				take: this.memoryContextSize,
			});
			const context = {
				recentMessages: recentMessages.reverse(), // Chronological order
			};
			this.logger.info(`Retrieved ${ recentMessages.length } recent messages for conversation context`);
			return context;
		} catch(error) {
			this.logger.error(`Error in ${ functionName }`, error);
			this.logger.exit(functionName, { error: true });
			throw new Error(`Error building context: ${ error.message }`);
		}
	}

	/**
	 * Formats memory items for use in context
	 * @param {Array} memoryItems
	 * @returns {Object} Memory formatted as key-value
	 */
	formatMemoryItems(memoryItems) {
		const functionName = 'formatMemoryItems';
		this.logger.entry(functionName, { count: memoryItems.length });
		const formattedMemory = {};
		let parseErrors = 0;
		memoryItems.forEach(item => {
			let value = item.value;
			try {
				if(item.type === 'number') {
					value = parseFloat(value);
					if(isNaN(value)) throw new Error('Parsed as NaN');
				} else if(item.type === 'boolean') {
					value = value.toLowerCase() === 'true';
				} else if(item.type === 'json') {
					value = JSON.parse(value);
				}
				formattedMemory[item.key] = value;
			} catch(e) {
				this.logger.warn(`Could not parse memory item '${ item.key }' with type '${ item.type }' and value '${ item.value }'. Storing as string. Error: ${ e.message }`);
				formattedMemory[item.key] = item.value; // Fallback to string
				parseErrors++;
			}
		});
		if(parseErrors > 0) {
			this.logger.warn(`Encountered ${ parseErrors } parsing errors while formatting memory items.`);
		}
		this.logger.exit(functionName, { formattedCount: Object.keys(formattedMemory).length });
		return formattedMemory;
	}

	/**
	 * Extracts strategies from memory objects
	 * @param {Array} memoryObjects
	 * @returns {Array} Strategies
	 */
	extractStrategies(memoryObjects) {
		const functionName = 'extractStrategies';
		this.logger.entry(functionName, { count: memoryObjects.length });
		const strategies = memoryObjects
			.filter(obj => obj.objectType === 'strategy')
			.map(strategy => {
				// Assuming strategy.data is already a JS object from Prisma JSON type
				return strategy.data;
			});
		this.logger.info(`Extracted ${ strategies.length } strategies.`);
		this.logger.exit(functionName, { strategyCount: strategies.length });
		return strategies;
	}

	/**
	 * Builds the request to send to the AI
	 * @param {Object} context Conversation context
	 * @param {string} userMessage User message
	 * @returns {Object} Request for AIService
	 */
	buildAIRequest(context, userMessage) {
		const functionName = 'buildAIRequest';
		this.logger.entry(functionName);
		try {
			const systemPrompt = this.buildSystemPrompt(context); // Logs internally
			const history = this.formatMessagesForAI(context.recentMessages); // Logs internally
			const memoryToolNames = [ 'retrieve_memory_items', 'retrieve_memory_objects', 'semantic_query', 'resolve_token_addresses' ];
			// obten todas las available actions menos las mencionadas arrbia
			const filteredActions = this.availableActions.actions
				.filter(action => action.isActive && !memoryToolNames.includes(action.name))
				.map(action => ({
					type: 'function',
					function: {
						name: action.name,
						description: action.description,
						parameters: action.parameters,
					},
				}));
			const request = {
				model: this.defaultModel,
				system: systemPrompt,
				prompt: userMessage,
				history: history,
				temperature: 0.7, // Example value
				tools: filteredActions,
				toolChoice: 'auto', // Example value
			};
			this.logger.success('Successfully built AI request object.');
			// Avoid logging the full request unless debugging
			this.logger.info('AI Request details:', {
				model: request.model,
				promptLength: request.prompt.length,
				historyLength: request.history.length,
				toolCount: request.tools.length,
				systemPromptLength: request.system.length,
			});
			this.logger.exit(functionName); // Not returning the large request object
			return request;
		} catch(error) {
			this.logger.error(`Error in ${ functionName }`, error);
			this.logger.exit(functionName, { error: true });
			throw error; // Re-throw needed? Depends if caller can handle.
		}
	}

	/**
	 * Builds the system prompt for the main AI consultation
	 * @param {Object} context - Enhanced context with resolution results
	 * @returns {string} System prompt
	 */
	buildSystemPrompt(context) {
		// Start with the base system prompt from the original method
		let systemPrompt = `You are an assistant expert in finance, blockchain and cryptocurrencies on the Solana network.
Your goal is to provide clear, useful information based on real market data, answering questions and proactively executing actions.

IMPORTANT GUIDELINES:
1. BE PROACTIVE: When the user asks about investments, tokens, or trends, ALWAYS immediately use available actions to obtain real data before asking for more information.
2. PRIORITIZE REAL DATA: Use 'recommend_tokens', 'fetch_top_tokens', or 'analyze_token_trend' in the first interaction to provide immediate value.
3. BASE YOUR RECOMMENDATIONS ON DATA: When offering suggestions, back them up with real data obtained through available tools.
4. EXECUTE MULTIPLE ACTIONS: Don't hesitate to execute several actions if necessary to provide a complete answer.
5. COMPLEMENT WITH QUESTIONS: After providing data-based information, you can ask questions to refine your response.

For investment questions, ALWAYS execute 'recommend_tokens' or 'fetch_top_tokens' first, then refine with questions.`;

		// Add available memory from context
		const { memoryItems, strategies } = context;

		if(Object.keys(memoryItems || {}).length > 0) {
			systemPrompt += `\n\nThere is no saved information about this user yet. Consider using the "remember_info" action when the user shares important information.`;
		}

		// Add strategies if they exist
		if(strategies && strategies.length > 0) {
			systemPrompt += `\n\nUSER STRATEGIES:`;
			strategies.forEach((strategy, index) => {
				systemPrompt += `\n${ index + 1 }. Name: ${ strategy.name }
   Description: ${ strategy.description }
   Tokens: ${ Array.isArray(strategy.tokens) ? strategy.tokens.join(', ') : strategy.tokens }
   Timeframe: ${ strategy.timeframe }`;
			});
		}

		// Add instructions about actions
		systemPrompt += `\n\nAVAILABLE ACTIONS:
You can perform actions when necessary. You MUST use these actions when:
1. The user requests information or data that requires blockchain access (EXECUTE IMMEDIATELY)
2. You identify important personal information or preferences that should be remembered
3. The user wants to create or modify investment or monitoring strategies
4. The user asks about information from previous conversations - use semantic_query
5. Alerts need to be scheduled or complex queries need to be executed

If the user asks about investments, recommendations, or "what to invest in," YOU MUST EXECUTE 'recommend_tokens' IMMEDIATELY with appropriate parameters before responding, and then provide a response based on the results.`;

		// ========= NEW: ADD MEMORY AND TOKEN RESOLUTION RESULTS =========

		// Add memory resolution results if available
		if(context.memoryResolution) {
			const { retrievedItems, retrievedObjects, semanticResults } = context.memoryResolution;

			if(retrievedItems && retrievedItems.length > 0) {
				systemPrompt += `\n\nRECENTLY RETRIEVED MEMORY ITEMS:`;
				retrievedItems.forEach(item => {
					let displayValue = item.value;
					if(typeof displayValue === 'object') {
						displayValue = JSON.stringify(displayValue);
					}
					systemPrompt += `\n- ${ item.key }: ${ displayValue }`;
				});
			}

			if(retrievedObjects && retrievedObjects.length > 0) {
				systemPrompt += `\n\nRECENTLY RETRIEVED USER OBJECTS:`;
				retrievedObjects.forEach((obj, index) => {
					systemPrompt += `\n${ index + 1 }. Type: ${ obj.type }, Name: ${ obj.name }`;

					// Add more details for strategies
					if(obj.type === 'strategy' && obj.data) {
						const strategy = obj.data;
						systemPrompt += `\n   Description: ${ strategy.description || 'No description' }`;
						systemPrompt += `\n   Tokens: ${ Array.isArray(strategy.tokens) ? strategy.tokens.join(', ') : strategy.tokens || 'None' }`;
						systemPrompt += `\n   Timeframe: ${ strategy.timeframe || 'Not specified' }`;
					}
				});
			}

			if(semanticResults && semanticResults.results && semanticResults.results.length > 0) {
				systemPrompt += `\n\nRELEVANT CONVERSATION HISTORY:`;
				semanticResults.results.forEach((result, index) => {
					systemPrompt += `\n${ index + 1 }. ${ result.document.substring(0, 150) }${ result.document.length > 150 ? '...' : '' }`;
				});
			}
		}

		// Add token resolution results if available
		if(context.tokenResolution && context.tokenResolution.resolvedTokens) {
			const { resolvedTokens } = context.tokenResolution;

			if(resolvedTokens.length > 0) {
				systemPrompt += `\n\nIDENTIFIED TOKENS:`;
				resolvedTokens.forEach(token => {
					systemPrompt += `\n- ${ token.token_symbol || 'Unknown' } (${ token.token_name || 'Unknown' }): ${ token.token_address }`;
				});

				systemPrompt += `\n\nIMPORTANT: When using Vybe API tools, ALWAYS use these exact token addresses instead of made-up ones. The first option (${ resolvedTokens[0].token_symbol }) with address ${ resolvedTokens[0].token_address } should be tried first.`;
			}
		}

		return systemPrompt;
	}

	/**
	 * Formats messages to send to the AI
	 * @param {Array} messages
	 * @returns {Array} Formatted messages
	 */
	formatMessagesForAI(messages) {
		const functionName = 'formatMessagesForAI';
		this.logger.entry(functionName, { count: messages.length });
		const formatted = messages.map(msg => ({
			role: msg.role,
			content: msg.text, // Assuming 'text' is the field with message content
		}));
		this.logger.exit(functionName, { formattedCount: formatted.length });
		return formatted;
	}

	/**
	 * Formats tools to send to the AI
	 * @returns {Array} Formatted tools
	 */
	formatToolsForAI() {
		const functionName = 'formatToolsForAI';
		this.logger.entry(functionName);
		try {
			// Filter only active actions and ensure they have the required fields
			const tools = this.availableActions.actions
				.filter(action => action && action.isActive && action.name && action.description && action.parameters && typeof action.parameters === 'object')
				.map(action => {
					// Basic validation of the parameters structure expected by OpenAI
					if(action.parameters.type !== 'object' || !action.parameters.properties || typeof action.parameters.properties !== 'object') {
						this.logger.warn(`Skipping action '${ action.name }' due to invalid parameters structure (must be JSON Schema object with properties).`, action.parameters);
						return null; // Skip this action if parameters aren't a valid schema object
					}

					// Directly use the parameters object defined in loadAvailableActions,
					// as it already follows the JSON Schema structure.
					return {
						type: 'function',
						function: {
							name: action.name,
							description: action.description,
							parameters: action.parameters, // Use the original object directly
						},
					};
				})
				.filter(tool => tool !== null); // Remove any nulls from invalid/skipped actions

			this.logger.success(`Formatted ${ tools.length } tools for AI.`);
			this.logger.exit(functionName, { toolCount: tools.length });
			return tools;
		} catch(error) {
			this.logger.error(`Error in ${ functionName }`, error);
			this.logger.exit(functionName, { error: true });
			return []; // Return empty array on error
		}
	}

	/**
	 * Updates the content and token count of an existing message.
	 * @param {number} messageId - The ID of the message to update.
	 * @param {string} newContent - The final content for the message.
	 * @returns {Promise<Object>} The updated message object.
	 */
	async updateMessageContent(messageId, newContent) {
		const functionName = 'updateMessageContent';
		const logContent = newContent.length > 100 ? newContent.substring(0, 97) + '...' : newContent;
		this.logger.entry(functionName, { messageId, newContent: logContent });
		try {
			const estimatedTokens = this.estimateTokens(newContent); // Logs internally
			this.logger.info(`Estimated tokens for updated content: ${ estimatedTokens }`);
			const updatedMessage = await this.prisma.message.update({
				where: { id: messageId },
				data: {
					text: newContent,
					tokens: estimatedTokens,
					// updated: new Date(), // Maybe add an 'updated' timestamp?
				},
			});
			this.logger.success('Message content updated successfully.', { messageId });
			this.logger.exit(functionName, { messageId: updatedMessage.id });
			return updatedMessage;
		} catch(error) {
			this.logger.error(`Error in ${ functionName } for message ID ${ messageId }`, error);
			this.logger.exit(functionName, { error: true });
			throw new Error(`Error updating message content for ID ${ messageId }: ${ error.message }`);
		}
	}

	/**
	 * Saves a function call to the database.
	 * @param {number} userId
	 * @param {number} chatId - Chat ID (for context)
	 * @param {string} name - Function name
	 * @param {Object} args - Function arguments
	 * @param {number} assistantMessageId - The ID of the message requesting this function call.
	 * @returns {Promise<Object>} Saved FunctionCall
	 */
	async saveFunctionCall(userId, chatId, name, args, assistantMessageId) {
		const functionName = 'saveFunctionCall';
		this.logger.entry(functionName, { userId, chatId, name, args, assistantMessageId });
		try {
			if(!assistantMessageId) {
				// This should not happen with the current sendMessage flow, but log defensively.
				this.logger.error('Missing assistantMessageId in saveFunctionCall. This indicates a logic error.', {
					userId,
					chatId,
					name,
				});
				throw new Error('Assistant Message ID is required to save function call');
			}

			const functionCall = await this.prisma.functionCall.create({
				data: {
					userId: userId,
					messageId: assistantMessageId, // Link to the assistant message
					name: name,
					arguments: args, // Prisma handles JSON serialization
					status: 'pending', // Initial status
					startTime: new Date(),
					// result, error, endTime, duration set later
				},
			});
			this.logger.success('Function call record saved.', { functionCallId: functionCall.id, name: name });
			this.logger.exit(functionName, { functionCallId: functionCall.id });
			return functionCall;
		} catch(error) {
			this.logger.error(`Error in ${ functionName }`, error);
			this.logger.exit(functionName, { error: true });
			throw new Error(`Error saving function call: ${ error.message }`);
		}
	}

	/**
	 * Executes a specific action based on its name.
	 * @param {number} functionCallId - ID of the corresponding FunctionCall record.
	 * @param {string} actionName - Name of the action to execute.
	 * @param {Object} args - Arguments for the action.
	 * @param {number} chatId - Current chat ID.
	 * @param {number} userId - Current user ID.
	 * @returns {Promise<Object>} Action result { success: boolean, data?: any, error?: string, duration: number }
	 */
	async executeAction(functionCallId, actionName, args, chatId, userId) {
		const functionName = 'executeAction';
		this.logger.entry(functionName, { functionCallId, actionName, args, chatId, userId });
		const startTime = Date.now();
		let resultPayload;

		try {
			this.logger.info(`Routing action: ${ actionName }`);
			// Execute action according to name
			switch(actionName) {
				// Existing actions
				case 'remember_info':
					resultPayload = await this.actionRememberInfo(chatId, args);
					break;
				case 'create_strategy':
					resultPayload = await this.actionCreateStrategy(chatId, args);
					break;
				case 'fetch_token_data':
					resultPayload = await this.actionFetchTokenData(args);
					break;
				case 'fetch_wallet_data':
					resultPayload = await this.actionFetchWalletData(args);
					break;
				case 'schedule_alert':
					resultPayload = await this.actionScheduleAlert(userId, chatId, args);
					break;
				case 'semantic_query':
					resultPayload = await this.actionSemanticQuery(args);
					break;
				case 'search_chat_history': // <--- NUEVO CASE
					resultPayload = await this.actionSearchChatHistory(args, chatId); // Pasa el chatId!
					break;
				case 'evaluate_query_intent':
					resultPayload = await this.actionEvaluateQueryIntent(args, chatId);
					break;
				// New actions
				case 'fetch_token_price_history':
					resultPayload = await this.actionFetchTokenPriceHistory(args);
					break;
				case 'fetch_token_holders_data':
					resultPayload = await this.actionFetchTokenHoldersData(args);
					break;
				case 'fetch_wallet_pnl':
					resultPayload = await this.actionFetchWalletPnl(args);
					break;
				case 'fetch_token_transfers':
					resultPayload = await this.actionFetchTokenTransfers(args);
					break;
				case 'fetch_top_tokens':
					resultPayload = await this.actionFetchTopTokens(args);
					break;
				case 'fetch_program_details':
					resultPayload = await this.actionFetchProgramDetails(args);
					break;
				case 'fetch_program_active_users':
					resultPayload = await this.actionFetchProgramActiveUsers(args);
					break;
				case 'fetch_program_tvl':
					resultPayload = await this.actionFetchProgramTvl(args);
					break;
				case 'fetch_program_ranking':
					resultPayload = await this.actionFetchProgramRanking(args);
					break;
				case 'fetch_market_info':
					resultPayload = await this.actionFetchMarketInfo(args);
					break;
				case 'fetch_pair_ohlcv':
					resultPayload = await this.actionFetchPairOhlcv(args);
					break;
				case 'analyze_token_trend':
					resultPayload = await this.actionAnalyzeTokenTrend(args);
					break;
				case 'recommend_tokens':
					resultPayload = await this.actionRecommendTokens(args);
					break;
				case 'create_price_alert':
					resultPayload = await this.actionCreatePriceAlert(userId, chatId, args);
					break;
				case 'get_known_accounts':
					resultPayload = await this.actionGetKnownAccounts(args);
					break;
				case 'get_wallet_tokens_time_series':
					resultPayload = await this.actionGetWalletTokensTimeSeries(args);
					break;
				case 'get_token_transfers_analysis':
					resultPayload = await this.actionGetTokenTransfersAnalysis(args);
					break;
				case 'get_price_prediction':
					resultPayload = await this.actionGetPricePrediction(args);
					break;
				case 'compare_tokens':
					resultPayload = await this.actionCompareTokens(args);
					break;
				case 'retrieve_memory_items':
					resultPayload = await this.actionRetrieveMemoryItems(chatId, args);
					break;
				case 'retrieve_memory_objects':
					resultPayload = await this.actionRetrieveMemoryObjects(chatId, args);
					break;
				case 'resolve_token_addresses':
					resultPayload = await this.actionResolveTokenAddresses(args);
					break;

				case 'store_user_name':
					resultPayload = await this.storeUserName(chatId, args.name);
					break;
				case 'store_risk_tolerance':
					resultPayload = await this.storeRiskTolerance(chatId, args.risk_level);
					break;
				case 'store_investment_timeframe':
					resultPayload = await this.storeInvestmentTimeframe(chatId, args.timeframe);
					break;
				case 'store_favorite_tokens':
					resultPayload = await this.storeFavoriteTokens(chatId, args.tokens);
					break;
				case 'store_investment_goals':
					resultPayload = await this.storeInvestmentGoals(chatId, args.goals);
					break;
				case 'store_trading_experience':
					resultPayload = await this.storeTradingExperience(chatId, args.level);
					break;
				case 'store_notification_preferences':
					resultPayload = await this.storeNotificationPreferences(chatId, args.preferences);
					break;
				case 'upsert_trading_strategy':
					resultPayload = await this.upsertTradingStrategy(chatId, args);
					break;
				case 'upsert_token_watchlist':
					resultPayload = await this.upsertTokenWatchlist(chatId, args);
					break;
				case 'upsert_portfolio_plan':
					resultPayload = await this.upsertPortfolioPlan(chatId, args);
					break;
				case 'upsert_trade_setup':
					resultPayload = await this.upsertTradeSetup(chatId, args);
					break;
				case 'upsert_market_analysis':
					resultPayload = await this.upsertMarketAnalysis(chatId, args);
					break;
				case 'get_user_name':
					resultPayload = await this.actionGetUserName(args, chatId);
					break;
				case 'get_risk_tolerance':
					resultPayload = await this.actionGetRiskTolerance(args, chatId);
					break;
				case 'get_investment_timeframe':
					resultPayload = await this.actionGetInvestmentTimeframe(args, chatId);
					break;
				case 'get_favorite_tokens':
					resultPayload = await this.actionGetFavoriteTokens(args, chatId);
					break;
				case 'get_investment_goals':
					resultPayload = await this.actionGetInvestmentGoals(args, chatId);
					break;
				case 'get_trading_experience':
					resultPayload = await this.actionGetTradingExperience(args, chatId);
					break;
				case 'get_notification_preferences':
					resultPayload = await this.actionGetNotificationPreferences(args, chatId);
					break;
				default:
					this.logger.error(`Action ${ actionName } not implemented.`);
					throw new Error(`Action ${ actionName } not implemented`);
			}

			const duration = Date.now() - startTime;
			this.logger.success(`Action ${ actionName } executed successfully.`, { duration: `${ duration }ms` });
			const finalResult = { success: true, data: resultPayload, duration };
			this.logger.exit(functionName, { success: true, duration });
			return finalResult;

		} catch(error) {
			const duration = Date.now() - startTime;
			this.logger.error(`Error executing action ${ actionName }`, error, { duration: `${ duration }ms` });
			const finalResult = { success: false, error: error.message, duration };
			this.logger.exit(functionName, { success: false, error: error.message, duration });
			return finalResult; // Return error structure
		}
	}

	/**
	 * Updates the result of a function call in the database.
	 * @param {number} functionCallId - The ID of the FunctionCall record.
	 * @param {Object} result - The result object from executeAction { success, data?, error?, duration }.
	 * @returns {Promise<void>}
	 */
	async updateFunctionCallResult(functionCallId, result) {
		const functionName = 'updateFunctionCallResult';
		this.logger.entry(functionName, { functionCallId, success: result.success });
		try {
			if(!result) {
				throw new Error('Result object cannot be null or undefined');
			}
			await this.prisma.functionCall.update({
				where: { id: functionCallId },
				data: {
					// Ensure result/error fields can handle the data (e.g., JSON type in schema)
					result: result.success ? (result.data ?? null) : null, // Store data only on success
					error: result.success ? null : (result.error ?? 'Unknown error'), // Store error message on failure
					status: result.success ? 'completed' : 'failed',
					endTime: new Date(),
					duration: result.duration ?? 0, // Ensure duration is stored
				},
			});
			this.logger.success(`Function call record ${ functionCallId } updated with status: ${ result.success ? 'completed' : 'failed' }.`);
			this.logger.exit(functionName);
		} catch(error) {
			this.logger.error(`Error in ${ functionName } for ID ${ functionCallId }`, error, { resultObject: result });
			this.logger.exit(functionName, { error: true });
			// Decide if re-throwing is necessary. Usually logging is sufficient here.
			// throw error;
		}
	}

	/**
	 * Updates chat statistics (message counter, last activity)
	 * @param {number} chatId
	 * @returns {Promise<void>}
	 */
	async updateChatStats(chatId) {
		const functionName = 'updateChatStats';
		this.logger.entry(functionName, { chatId });
		try {
			this.logger.info('Counting active messages for chat.');
			const count = await this.prisma.message.count({
				where: { chatId: chatId, status: 'Active' },
			});
			this.logger.info(`Found ${ count } active messages. Updating chat record.`);
			await this.prisma.chat.update({
				where: { id: chatId },
				data: {
					messageCount: count,
					lastMessageAt: new Date(),
				},
			});
			this.logger.success('Chat stats updated successfully.', { chatId, messageCount: count });
			this.logger.exit(functionName);
		} catch(error) {
			this.logger.error(`Error in ${ functionName } for chat ID ${ chatId }`, error);
			this.logger.exit(functionName, { error: true });
			// Avoid throwing from here unless critical, as it might interrupt the main flow
			// throw error;
		}
	}

	/**
	 * Action: Remember user information
	 */
	async actionRememberInfo(chatId, args) {
		const functionName = 'actionRememberInfo';
		this.logger.entry(functionName, { chatId, args });
		const { key, value, confidence = '1.0', source = 'llm' } = args;
		if(!key || value === undefined || value === null) { // Check for undefined/null value too
			this.logger.error('Key and value are required.', { args });
			throw new Error('Key and value are required for remember_info action');
		}
		try {
			// Determine data type
			let type = 'string';
			const trimmedValue = String(value).trim(); // Work with string representation for checks
			if(!isNaN(trimmedValue) && trimmedValue !== '') {
				type = 'number';
			} else if(trimmedValue.toLowerCase() === 'true' || trimmedValue.toLowerCase() === 'false') {
				type = 'boolean';
			} else if((trimmedValue.startsWith('{') && trimmedValue.endsWith('}')) || (trimmedValue.startsWith('[') && trimmedValue.endsWith(']'))) {
				try {
					JSON.parse(trimmedValue); // Validate JSON structure
					type = 'json';
				} catch(e) { /* Not valid JSON, keep as string */
					this.logger.info(`Value for key '${ key }' looks like JSON but failed to parse. Storing as string.`);
				}
			}

			this.logger.info(`Determined type for key '${ key }' as '${ type }'. Upserting...`);
			const valueStr = String(value); // Ensure value is stored as string in DB
			const confidenceFloat = parseFloat(confidence);
			if(isNaN(confidenceFloat)) {
				this.logger.warn(`Invalid confidence value '${ confidence }', defaulting to 1.0`);
			}

			const memoryItem = await this.prisma.memoryItem.upsert({
				where: { chat_key_unique: { chatId, key } },
				update: { value: valueStr, type, source, confidence: isNaN(confidenceFloat) ? 1.0 : confidenceFloat },
				create: {
					chatId,
					key,
					value: valueStr,
					type,
					source,
					confidence: isNaN(confidenceFloat) ? 1.0 : confidenceFloat,
				},
			});

			const result = { stored: true, key, value: value, type, itemId: memoryItem.id }; // Return original value
			this.logger.success(`Stored/updated memory item:`, result);
			this.logger.exit(functionName, result);
			return result;
		} catch(error) {
			this.logger.error(`Failed in ${ functionName }`, error);
			this.logger.exit(functionName, { error: true });
			throw new Error(`Failed to store information: ${ error.message }`);
		}
	}

	/**
	 * Action: Create strategy
	 */
	async actionCreateStrategy(chatId, args) {
		const functionName = 'actionCreateStrategy';
		this.logger.entry(functionName, { chatId, args });
		const { name, description, tokens, rules, timeframe } = args;
		if(!name || !description) {
			this.logger.error('Name and description are required.', { args });
			throw new Error('Name and description are required for create_strategy action');
		}

		let tokensList = [];
		if(typeof tokens === 'string') {
			this.logger.info('Parsing tokens string:', tokens);
			if(tokens.trim().startsWith('[') && tokens.trim().endsWith(']')) {
				try {
					tokensList = JSON.parse(tokens);
					if(!Array.isArray(tokensList)) throw new Error('Parsed result is not an array');
				} catch(e) {
					this.logger.warn(`Failed to parse token string as JSON array: '${ tokens }'. Splitting by comma. Error: ${ e.message }`);
					tokensList = tokens.replace(/^\[|\]$/g, '').split(',').map(t => t.trim()).filter(t => t); // Basic split/trim
				}
			} else if(tokens.trim()) {
				this.logger.info('Token string is not array-like, splitting by comma.');
				tokensList = tokens.split(',').map(t => t.trim()).filter(t => t); // Basic split/trim
			} else {
				this.logger.info('Tokens string is empty.');
			}
		} else if(Array.isArray(tokens)) {
			this.logger.info('Tokens provided as array.');
			tokensList = tokens;
		} else {
			this.logger.warn('Tokens argument is neither a string nor an array.', { tokens });
		}
		this.logger.info('Processed token list:', tokensList);

		try {
			const strategyData = {
				name, description, tokens: tokensList, rules, timeframe, createdAt: new Date().toISOString(),
			};
			this.logger.info('Creating memory object for strategy:', strategyData);
			const strategy = await this.prisma.memoryObject.create({
				data: {
					chatId,
					objectType: 'strategy',
					name, // Can be used for quick lookups if needed
					data: strategyData, // Store the full details as JSON
					isActive: true,
				},
			});

			const result = {
				created: true,
				strategy: { id: strategy.id, name, description, tokens: tokensList, timeframe },
			};
			this.logger.success('Strategy created successfully.', result);
			this.logger.exit(functionName, result);
			return result;
		} catch(error) {
			this.logger.error(`Failed in ${ functionName }`, error);
			this.logger.exit(functionName, { error: true });
			throw new Error(`Failed to create strategy: ${ error.message }`);
		}
	}

	/**
	 * Action: Fetch token data
	 */
	async actionFetchTokenData(args) {
		const functionName = 'actionFetchTokenData';
		this.logger.entry(functionName, { args });
		const { token_address, include_price, include_holders } = args; // include_price not used in current Vybe calls
		if(!token_address) {
			this.logger.error('Token address is required.', { args });
			throw new Error('Token address is required for fetch_token_data action');
		}
		try {
			this.logger.info(`Workspaceing token details for ${ token_address }...`);
			const tokenDetails = await VybeService.getTokenDetails(token_address);
			this.logger.info('Token details received:', tokenDetails); // Might be large

			let holders = null;
			const shouldIncludeHolders = String(include_holders).toLowerCase() === 'true';
			if(shouldIncludeHolders) {
				this.logger.info(`Workspaceing top holders for ${ token_address }...`);
				try {
					holders = await VybeService.getTopTokenHolders(token_address, { limit: 5 }); // Example limit
					this.logger.info('Token holders received:', holders); // Might be large
				} catch(e) {
					this.logger.warn(`Failed to fetch token holders for ${ token_address }. Continuing without them.`, e);
				}
			}

			// Combine results
			const combinedData = { token: tokenDetails, holders: holders?.data || null }; // Use .data if holders object has it
			const combinedDataString = JSON.stringify(combinedData);
			const dataSizeKB = Math.round(combinedDataString.length / 1024);
			this.logger.info(`Combined data size: ~${ dataSizeKB } KB`);

			// Simplified Chroma logic: Store if data seems large (e.g., > 30KB)
			// You might want more sophisticated logic or always store certain types
			let chromaTokenData = null;
			const sizeThresholdKB = 30;
			if(dataSizeKB > sizeThresholdKB) {
				this.logger.info(`Data size (${ dataSizeKB }KB) exceeds threshold (${ sizeThresholdKB }KB), attempting to store in Chroma...`);
				try {
					const collectionName = `token_data_${ token_address.slice(0, 8) }`; // Example naming
					const collection = await ChromaService.getOrCreateCollection(collectionName);
					const documents = [ JSON.stringify(tokenDetails) ]; // Store details separately?
					const ids = [ `details_${ token_address }_${ Date.now() }` ];
					const metadatas = [ { type: 'token_details', token_address, timestamp: new Date().toISOString() } ];
					if(holders && holders.data) {
						documents.push(JSON.stringify(holders.data)); // Store holders separately?
						ids.push(`holders_${ token_address }_${ Date.now() }`);
						metadatas.push({ type: 'token_holders', token_address, timestamp: new Date().toISOString() });
					}
					this.logger.info(`Generating embeddings for ${ documents.length } documents...`);
					const embeddings = await ChromaService.generateEmbeddings(documents);
					this.logger.info(`Adding documents to Chroma collection: ${ collectionName }`);
					await ChromaService.addDocuments(collection, documents, ids, embeddings, metadatas);
					chromaTokenData = {
						collection_name: collection.name,
						document_count: documents.length,
						timestamp: new Date().toISOString(),
					};
					this.logger.success('Successfully stored data in Chroma.', chromaTokenData);
				} catch(chromaError) {
					this.logger.error('Failed to store token data in Chroma.', chromaError);
					// Continue without Chroma data if it fails
				}
			}

			// Format final result
			const result = {
				token: tokenDetails,
				holders: holders?.data || null, // Ensure consistent structure
				...(chromaTokenData && { chroma_data: chromaTokenData }), // Conditionally add chroma info
			};
			this.logger.success(`Completed ${ functionName } for ${ token_address }`);
			this.logger.exit(functionName); // Not returning full result data in exit log
			return result;

		} catch(error) {
			this.logger.error(`Failed in ${ functionName } for ${ token_address }`, error);
			this.logger.exit(functionName, { error: true });
			throw new Error(`Failed to fetch token data: ${ error.message }`);
		}
	}

	/**
	 * Action: Fetch wallet data
	 */
	async actionFetchWalletData(args) {
		this.logger.info('');
		const functionName = 'actionFetchWalletData';
		this.logger.entry(functionName, { args });
		const { wallet_address, include_tokens = true, include_nfts = true } = args;
		this.logger.info('const wallet_address = ', wallet_address);
		this.logger.info('const include_tokens = ', include_tokens);
		this.logger.info('const include_nfts = ', include_nfts);
		if(!wallet_address) {
			this.logger.error('Wallet address is required.', { args });
			throw new Error('Wallet address is required for fetch_wallet_data action');
		}

		try {
			let tokensData = null;
			let nftsData = null;
			const shouldIncludeTokens = String(include_tokens).toLowerCase() === 'true';
			const shouldIncludeNfts = String(include_nfts).toLowerCase() === 'true';

			if(shouldIncludeTokens) {
				this.logger.info(`Workspaceing tokens for wallet ${ wallet_address }...`);
				try {
					tokensData = await VybeService.getWalletTokens(wallet_address, { limit: 10 }); // Example limit
					this.logger.info('Wallet tokens received:', tokensData); // Might be large
				} catch(e) {
					this.logger.warn(`Failed to fetch wallet tokens for ${ wallet_address }. Continuing without them.`, e);
				}
			}

			if(shouldIncludeNfts) {
				this.logger.info(`Workspaceing NFTs for wallet ${ wallet_address }...`);
				try {
					nftsData = await VybeService.getWalletNfts(wallet_address, { limit: 10 }); // Example limit
					this.logger.info('Wallet NFTs received:', nftsData); // Might be large
				} catch(e) {
					this.logger.warn(`Failed to fetch wallet NFTs for ${ wallet_address }. Continuing without them.`, e);
				}
			}

			// Combine results
			const combinedData = { tokens: tokensData, nfts: nftsData };
			const combinedDataString = JSON.stringify(combinedData);
			const dataSizeKB = Math.round(combinedDataString.length / 1024);
			this.logger.info(`Combined wallet data size: ~${ dataSizeKB } KB`);

			// Simplified Chroma logic (similar to token data)
			let chromaWalletData = null;
			const sizeThresholdKB = 30;
			if(dataSizeKB > sizeThresholdKB) {
				this.logger.info(`Wallet data size (${ dataSizeKB }KB) exceeds threshold (${ sizeThresholdKB }KB), attempting to store in Chroma...`);
				try {
					const collectionName = `wallet_data_${ wallet_address.slice(0, 8) }`;
					const collection = await ChromaService.getOrCreateCollection(collectionName);
					const documents = [];
					const ids = [];
					const metadatas = [];
					if(tokensData) {
						documents.push(JSON.stringify(tokensData));
						ids.push(`tokens_${ wallet_address }_${ Date.now() }`);
						metadatas.push({ type: 'wallet_tokens', wallet_address, timestamp: new Date().toISOString() });
					}
					if(nftsData) {
						documents.push(JSON.stringify(nftsData));
						ids.push(`nfts_${ wallet_address }_${ Date.now() }`);
						metadatas.push({ type: 'wallet_nfts', wallet_address, timestamp: new Date().toISOString() });
					}

					if(documents.length > 0) {
						this.logger.info(`Generating embeddings for ${ documents.length } wallet documents...`);
						const embeddings = await ChromaService.generateEmbeddings(documents);
						this.logger.info(`Adding documents to Chroma collection: ${ collectionName }`);
						await ChromaService.addDocuments(collection, documents, ids, embeddings, metadatas);
						chromaWalletData = {
							collection_name: collection.name,
							document_count: documents.length,
							timestamp: new Date().toISOString(),
						};
						this.logger.success('Successfully stored wallet data in Chroma.', chromaWalletData);
					} else {
						this.logger.info('No token or NFT data fetched, nothing to store in Chroma.');
					}
				} catch(chromaError) {
					this.logger.error('Failed to store wallet data in Chroma.', chromaError);
				}
			}

			// Format final result
			const result = {
				wallet: wallet_address,
				tokens: tokensData,
				nfts: nftsData,
				...(chromaWalletData && { chroma_data: chromaWalletData }),
			};
			this.logger.success(`Completed ${ functionName } for ${ wallet_address }`);
			this.logger.exit(functionName); // Not returning full result data
			return result;

		} catch(error) {
			this.logger.error(`Failed in ${ functionName } for ${ wallet_address }`, error);
			this.logger.exit(functionName, { error: true });
			throw new Error(`Failed to fetch wallet data: ${ error.message }`);
		}
	}

	/**
	 * Action: Schedule alert
	 */
	async actionScheduleAlert(userId, chatId, args) {
		const functionName = 'actionScheduleAlert';
		this.logger.entry(functionName, { userId, chatId, args });
		const { type, condition, message, scheduled_for } = args;
		if(!type || !message) {
			this.logger.error('Type and message are required.', { args });
			throw new Error('Type and message are required for schedule_alert action');
		}
		try {
			let scheduledDate = null;
			if(scheduled_for) {
				try {
					scheduledDate = new Date(scheduled_for);
					if(isNaN(scheduledDate.getTime())) {
						this.logger.warn(`Invalid date format for scheduled_for: '${ scheduled_for }'. Scheduling without specific time.`);
						scheduledDate = null; // Treat as invalid
					} else {
						this.logger.info(`Parsed scheduled_for date: ${ scheduledDate.toISOString() }`);
					}
				} catch(e) {
					this.logger.warn(`Could not parse scheduled_for date string: '${ scheduled_for }'. Error: ${ e.message }`);
				}
			}

			const taskPayload = { type, condition, message, chatId }; // Data needed when the alert runs
			const functionArgs = { type, message }; // Simplified args for the target function
			const taskName = `${ type } Alert for Chat ${ chatId }`; // Example name

			this.logger.info(`Creating scheduled task: ${ taskName }`);
			const task = await this.prisma.scheduledTask.create({
				data: {
					userId,
					taskType: 'alert',
					name: taskName,
					description: message, // Or a more structured description
					cronExpression: null, // Assuming one-time based on condition or date
					scheduledFor: scheduledDate, // If null, needs separate check logic
					payload: taskPayload,
					functionName: 'sendAlert', // Name of the function to eventually execute
					functionArgs: functionArgs,
					status: 'Pending',
					recurrent: false, // Assuming non-recurrent for now
				},
			});

			const result = {
				scheduled: true,
				taskId: task.id,
				type,
				scheduledFor: task.scheduledFor ? task.scheduledFor.toISOString() : 'Based on condition', // Informative message
			};
			this.logger.success('Alert scheduled successfully.', result);
			this.logger.exit(functionName, result);
			return result;
		} catch(error) {
			this.logger.error(`Failed in ${ functionName }`, error);
			this.logger.exit(functionName, { error: true });
			throw new Error(`Failed to schedule alert: ${ error.message }`);
		}
	}

	/**
	 * Action: Evaluate query intent to determine if semantic search is needed
	 */
	async actionEvaluateQueryIntent(args, chatId) {
		const functionName = 'actionEvaluateQueryIntent';
		this.logger.entry(functionName, { args, chatId });
		const { user_query, chat_history_summary } = args;
		if(!user_query) {
			this.logger.error('User query is required.', { args });
			throw new Error('User query is required for evaluate_query_intent action');
		}
		try {
			let collections = [];
			let chatCollections = [], tokenCollections = [], walletCollections = [];
			try {
				this.logger.info('Listing Chroma collections...');
				collections = await ChromaService.listCollections();
				this.logger.info('Available Chroma collections:', collections);
				// Filter collections by type (adjust prefixes if needed)
				chatCollections = collections.filter(col => col.startsWith(`chat-${ chatId }`) || col.includes('chat'));
				tokenCollections = collections.filter(col => col.startsWith('token_data_'));
				walletCollections = collections.filter(col => col.startsWith('wallet_data_'));
				this.logger.info('Filtered collections:', {
					chat: chatCollections,
					token: tokenCollections,
					wallet: walletCollections,
				});
			} catch(error) {
				this.logger.warn('Failed to list Chroma collections. Proceeding without collection list.', error);
				// Continue without collections, the AI might still decide based on query content
			}

			// Build prompt for AI evaluation
			const prompt = `
You are an expert system... (Your full prompt here) ...
USER QUERY: "${ user_query }"
${ chat_history_summary ? `CHAT HISTORY SUMMARY: ${ chat_history_summary }` : '' }
AVAILABLE COLLECTIONS:
${ chatCollections.length > 0 ? `- Chat collections: ${ chatCollections.join(', ') }` : '- No specific chat collections available' }
${ tokenCollections.length > 0 ? `- Token collections: ${ tokenCollections.join(', ') }` : '- No token collections available' }
${ walletCollections.length > 0 ? `- Wallet collections: ${ walletCollections.join(', ') }` : '- No wallet collections available' }
Respond with a JSON object... (Your full JSON instruction here) ...
`;
			this.logger.info('Sending query intent evaluation request to AI.');
			const response = await AIService.sendMessage({
				model: this.defaultModel, // Maybe a smaller/faster model is sufficient?
				system: 'You\'re an AI that assesses if queries need semantic search. Return only valid JSON.',
				prompt: prompt,
				temperature: 0.3, // Lower temp for consistent JSON
				responseFormat: { type: 'json_object' },
			});
			this.logger.info('Raw AI response for query intent:', response);

			let evaluationResult;
			if(response.choices?.[0]?.message?.content) {
				try {
					const rawJson = response.choices[0].message.content;
					evaluationResult = JSON.parse(rawJson);
					this.logger.success('Parsed query intent evaluation response.');
					this.logger.info('Evaluation Result:', evaluationResult);

					// Simple logic to recommend a default collection if needed and none provided
					if(evaluationResult.needs_semantic_search && !evaluationResult.recommended_collection && collections.length > 0) {
						this.logger.info('AI recommended search but no collection, attempting to infer...');
						if(chatCollections.length > 0 && (user_query.toLowerCase()
							.includes('remember') || user_query.toLowerCase()
							.includes('said') || user_query.toLowerCase().includes('told you'))) {
							evaluationResult.recommended_collection = chatCollections[0]; // Prioritize specific chat collection
						} else if(tokenCollections.length > 0 && (user_query.toLowerCase()
							.includes('token') || user_query.toLowerCase().includes('coin') || user_query.toLowerCase()
							.includes('price'))) {
							evaluationResult.recommended_collection = tokenCollections[0];
						} else if(walletCollections.length > 0 && (user_query.toLowerCase()
							.includes('wallet') || user_query.toLowerCase().includes('address'))) {
							evaluationResult.recommended_collection = walletCollections[0];
						} else if(chatCollections.length > 0) {
							evaluationResult.recommended_collection = chatCollections[0]; // Fallback to chat
						} else {
							evaluationResult.recommended_collection = collections[0]; // Absolute fallback
						}
						this.logger.info(`Inferred recommended collection: ${ evaluationResult.recommended_collection }`);
					} else if(evaluationResult.needs_semantic_search && evaluationResult.recommended_collection && !collections.includes(evaluationResult.recommended_collection)) {
						this.logger.warn(`AI recommended collection '${ evaluationResult.recommended_collection }' which does not exist in the current list. Search might fail.`);
					}

				} catch(e) {
					this.logger.error('Failed to parse evaluation response JSON', e, { rawResponse: response.choices[0].message.content });
					evaluationResult = {
						needs_semantic_search: false,
						optimized_query: user_query,
						recommended_collection: '',
						reasoning: 'Failed to parse AI JSON response',
					};
				}
			} else {
				this.logger.error('No valid content in AI evaluation response.');
				evaluationResult = {
					needs_semantic_search: false,
					optimized_query: user_query,
					recommended_collection: '',
					reasoning: 'No content in AI response',
				};
			}

			this.logger.exit(functionName, evaluationResult);
			return evaluationResult;
		} catch(error) {
			this.logger.error(`Failed in ${ functionName }`, error);
			this.logger.exit(functionName, { error: true });
			throw new Error(`Failed to evaluate query intent: ${ error.message }`);
		}
	}

	/**
	 * Action: Perform semantic query
	 */
	/**
	 * Action: Perform semantic query
	 */
	async actionSemanticQuery(args) {
		const functionName = 'actionSemanticQuery';
		this.logger.entry(functionName, { args });

		const { query: originalQuery, limit = '5' } = args;

		if(!originalQuery) {
			this.logger.error('Original query text is required.', { args });
			this.logger.exit(functionName, { error: true });
			throw new Error('Query is required for semantic_query action');
		}

		const targetCollectionName = ConversationService.TOKEN_COLLECTION_NAME;
		this.logger.info(`Query target collection: '${ targetCollectionName }'`);

		if(args.collection && args.collection !== targetCollectionName) {
			this.logger.warn(`Ignoring provided collection argument '${ args.collection }'. Using '${ targetCollectionName }'.`);
		}

		let finalLimit = 5;
		const parsedLimit = parseInt(limit, 10);
		if(!isNaN(parsedLimit) && parsedLimit > 0) {
			finalLimit = parsedLimit;
		} else if(limit !== '5') {
			this.logger.warn(`Invalid limit '${ limit }' provided, defaulting to ${ finalLimit }.`);
		}

		let optimizedQuery = originalQuery;

		try {
			try {
				this.logger.info(`Requesting JSON query optimization via AIService.sendMessage for: "${ originalQuery }"`);

				const optimizationPrompt = `
You are an expert system assisting with semantic search in a vector database containing cryptocurrency token information (name, symbol, tags, description).
Your task is to rephrase the following user query to be optimal for finding relevant tokens via vector similarity search. Focus on extracting key entities, concepts, and technical terms related to tokens, blockchains, or DeFi.

Respond ONLY with a valid JSON object containing a single key: "query". The value associated with the "query" key should be the optimized query string. Do not include any other text, explanations, or markdown formatting outside the JSON object.

User Query: "${ originalQuery }"

JSON Response:`;

				this.logger.info('Sending optimization prompt to AIService for JSON response...');

				// FIXED: Properly call AIService with correct capitalization and parameter structure
				const aiResponse = await AIService.sendMessage({
					model: this.defaultModel,
					system: 'You are a search query generator. Extract only cryptocurrency token identifiers from user text.',
					prompt: optimizationPrompt,
					temperature: 0.2,
					responseFormat: { type: 'json_object' },
				});

				// FIXED: Properly access the response content
				const aiResponseJsonString = aiResponse.choices && aiResponse.choices[0]?.message?.content;
				this.logger.info(`Raw JSON string response from AIService.sendMessage: "${ aiResponseJsonString }"`);

				if(aiResponseJsonString && typeof aiResponseJsonString === 'string') {
					try {
						const parsedResponse = JSON.parse(aiResponseJsonString);
						if(parsedResponse && typeof parsedResponse.query === 'string' && parsedResponse.query.trim()) {
							optimizedQuery = parsedResponse.query.trim();
							this.logger.info(`Optimized query extracted from JSON response: "${ optimizedQuery }"`);
							if(optimizedQuery.toLowerCase() === originalQuery.toLowerCase()) {
								this.logger.warn('AIService optimization via JSON mode did not significantly change the query.');
							}
						} else {
							this.logger.warn('AIService JSON response did not contain a valid "query" key. Falling back to original query.', { parsedResponse });
							optimizedQuery = originalQuery;
						}
					} catch(parseError) {
						this.logger.error(`Failed to parse JSON response from AIService: ${ parseError.message }. Falling back to original query.`, { rawResponse: aiResponseJsonString });
						optimizedQuery = originalQuery;
					}
				} else {
					this.logger.warn('AIService.sendMessage returned empty or invalid response for JSON optimization. Falling back to original query.');
					optimizedQuery = originalQuery;
				}

			} catch(aiError) {
				this.logger.error(`Failed to optimize query using AIService.sendMessage (JSON mode): ${ aiError.message }. Proceeding with the original query.`, aiError);
				optimizedQuery = originalQuery;
			}

			this.logger.info(`Performing semantic query in '${ targetCollectionName }' with final query "${ optimizedQuery }" (limit ${ finalLimit }).`);

			this.logger.info('Instantiating OpenAI embedding function...');
			if(!process.env.OPENAI_API_KEY) {
				this.logger.error('OpenAI API Key is missing.');
				throw new Error('Missing OpenAI API Key configuration.');
			}
			const embeddingFunction = new OpenAIEmbeddingFunction({
				openai_api_key: process.env.OPENAI_API_KEY,
				openai_model: ConversationService.TOKEN_EMBEDDING_MODEL,
			});
			this.logger.info(`Embedding function created for model: ${ ConversationService.TOKEN_EMBEDDING_MODEL }.`);

			this.logger.info(`Getting collection '${ targetCollectionName }' with embedding function...`);
			const chromaCollection = await ChromaService.client.getCollection({
				name: targetCollectionName,
				embeddingFunction: embeddingFunction,
			});
			this.logger.info(`Successfully obtained collection object for '${ chromaCollection.name }'.`);

			this.logger.info('Executing ChromaDB query...');
			const results = await chromaCollection.query({
				queryTexts: [ optimizedQuery ],
				nResults: finalLimit,
				include: [ 'documents', 'metadatas', 'distances' ],
			});
			this.logger.info('Raw Chroma query results received.');

			let formattedResults = [];
			if(results && results.ids && results.ids.length > 0 && results.ids[0].length > 0) {
				const count = results.ids[0].length;
				formattedResults = results.ids[0].map((id, i) => ({
					id: id,
					document: results.documents?.[0]?.[i] ?? null,
					metadata: results.metadatas?.[0]?.[i] ?? null,
					distance: results.distances?.[0]?.[i] ?? null,
				}));
				this.logger.info(`Semantic query found ${ count } results.`);
				this.logger.info('Formatted semantic query results:', formattedResults);
			} else {
				this.logger.info('Semantic query returned no results.');
			}

			const finalResult = {
				// originalQuery: originalQuery,
				optimizedQuery: optimizedQuery,
				// collection: targetCollectionName,
				//limit: finalLimit,
				results: formattedResults,
			};

			this.logger.success(`Semantic query for collection '${ targetCollectionName }' completed successfully.`);
			this.logger.exit(functionName);
			return finalResult;

		} catch(error) {
			this.logger.error(`Failed during semantic query process in '${ targetCollectionName }': ${ error.message }`, error);
			if(error.stack) {
				this.logger.info(`Stack trace: ${ error.stack }`);
			}
			if(error.message && (error.message.toLowerCase().includes('not found') || error.message.toLowerCase()
				.includes('does not exist'))) {
				this.logger.error(`Target collection '${ targetCollectionName }' does not seem to exist.`);
			}
			this.logger.exit(functionName, { error: true });
			throw new Error(`Failed to perform semantic query in ${ targetCollectionName }: ${ error.message }`);
		}
	}

	async getUserConversations(userId, options = {}) {
		const functionName = 'getUserConversations';
		this.logger.entry(functionName, { userId, options });
		const { limit = 10, offset = 0, status = 'Active' } = options;
		try {
			const conversations = await this.prisma.chat.findMany({
				where: { userId, status },
				orderBy: { lastMessageAt: 'desc' },
				skip: offset,
				take: limit,
				include: { _count: { select: { messages: true } } }, // Include message count efficiently
			});
			this.logger.success(`Workspaceed ${ conversations.length } conversations for user ${ userId }.`);
			this.logger.exit(functionName, { count: conversations.length });
			return conversations;
		} catch(error) {
			this.logger.error(`Failed in ${ functionName } for user ${ userId }`, error);
			this.logger.exit(functionName, { error: true });
			throw new Error(`Failed to get conversations: ${ error.message }`);
		}
	}

	async getConversation(chatId, userId, options = {}) {
		const functionName = 'getConversation';
		this.logger.entry(functionName, { chatId, userId, options });
		const { messageLimit = 50, messageOffset = 0 } = options;
		try {
			// Get chat
			this.logger.info(`Workspaceing chat details for ID ${ chatId }...`);
			const chat = await this.prisma.chat.findFirst({
				where: { id: chatId, userId, status: 'Active' }, // Ensure user owns the chat
			});
			if(!chat) {
				this.logger.error(`Conversation not found or access denied.`, { chatId, userId });
				throw new Error('Conversation not found');
			}
			this.logger.info('Chat details found.');

			// Get messages
			this.logger.info(`Workspaceing messages for chat ${ chatId } (limit: ${ messageLimit }, offset: ${ messageOffset })...`);
			const messages = await this.prisma.message.findMany({
				where: { chatId, status: 'Active' },
				orderBy: { created: 'asc' },
				skip: messageOffset,
				take: messageLimit,
			});
			this.logger.info(`Workspaceed ${ messages.length } messages.`);

			// Get memory items & objects (similar to buildContext)
			this.logger.info(`Workspaceing memory items for chat ${ chatId }...`);
			const memoryItems = await this.prisma.memoryItem.findMany({ where: { chatId } });
			this.logger.info(`Workspaceed ${ memoryItems.length } memory items.`);

			this.logger.info(`Workspaceing active memory objects for chat ${ chatId }...`);
			const memoryObjects = await this.prisma.memoryObject.findMany({ where: { chatId, isActive: true } });
			this.logger.info(`Workspaceed ${ memoryObjects.length } memory objects.`);

			const formattedMemory = this.formatMemoryItems(memoryItems); // Logs internally

			const result = {
				chat,
				messages,
				memory: {
					items: formattedMemory,
					objects: memoryObjects, // Return raw objects
				},
			};
			this.logger.success(`Successfully fetched conversation details for chat ${ chatId }.`);
			this.logger.exit(functionName); // Not returning full data
			return result;
		} catch(error) {
			this.logger.error(`Failed in ${ functionName } for chat ${ chatId }`, error);
			this.logger.exit(functionName, { error: true });
			// Don't expose internal errors directly if this is user-facing
			if(error.message === 'Conversation not found') throw error;
			throw new Error(`Failed to get conversation details.`);
		}
	}

	/**
	 * Creates a semantic search collection from chat history
	 */
	async createSearchCollection(chatId, collectionName = null) {
		const functionName = 'createSearchCollection';
		this.logger.entry(functionName, { chatId, collectionName });
		try {
			// Get messages
			this.logger.info(`Workspaceing active messages for chat ${ chatId } to create collection...`);
			const messages = await this.prisma.message.findMany({
				where: { chatId, status: 'Active' },
				orderBy: { created: 'asc' },
			});
			if(messages.length === 0) {
				this.logger.warn(`No active messages found for chat ${ chatId }. Cannot create search collection.`);
				// throw new Error('No messages found to create collection'); // Or return gracefully
				this.logger.exit(functionName, { success: false, reason: 'No messages' });
				return { collection: null, documentCount: 0, info: 'No messages to index.' };
			}
			this.logger.info(`Found ${ messages.length } messages for indexing.`);

			// Get chat details for context/naming
			const chat = await this.prisma.chat.findUnique({ where: { id: chatId } });

			// Generate collection name (ensure uniqueness and validity)
			const baseName = collectionName || `chat-${ chatId }`;
			// Basic sanitization for collection name (Chroma might have specific rules)
			const sanitizedBase = baseName.replace(/[^a-zA-Z0-9_-]/g, '_');
			const finalCollectionName = `${ sanitizedBase }-${ Date.now() }`; // Add timestamp for uniqueness
			this.logger.info(`Creating/getting Chroma collection: ${ finalCollectionName }`);

			const chromaCollection = await ChromaService.getOrCreateCollection(finalCollectionName);

			// Prepare documents, ids, metadatas
			const documents = messages.map(msg => msg.text || ''); // Ensure text exists
			const ids = messages.map(msg => `msg-${ msg.id }`);
			const metadatas = messages.map(msg => ({
				messageId: msg.id,
				role: msg.role,
				timestamp: msg.created.toISOString(),
				// Add other relevant metadata? userId?
			}));

			// Generate embeddings and add
			this.logger.info(`Generating embeddings for ${ documents.length } documents...`);
			const embeddings = await ChromaService.generateEmbeddings(documents);
			this.logger.info(`Adding ${ documents.length } documents to collection ${ finalCollectionName }...`);
			await ChromaService.addDocuments(chromaCollection, documents, ids, embeddings, metadatas);

			const result = {
				collection: finalCollectionName,
				documentCount: documents.length,
				chatTitle: chat?.title || `Chat #${ chatId }`,
			};
			this.logger.success('Search collection created/updated successfully.', result);
			this.logger.exit(functionName, result);
			return result;
		} catch(error) {
			this.logger.error(`Failed in ${ functionName } for chat ${ chatId }`, error);
			this.logger.exit(functionName, { error: true });
			throw new Error(`Failed to create search collection: ${ error.message }`);
		}
	}

	/**
	 * Action: Fetch token price history
	 */
	async actionFetchTokenPriceHistory(args) {
		const functionName = 'actionFetchTokenPriceHistory';
		this.logger.entry(functionName, { args });
		const { token_address, resolution = '1d', time_start, time_end, limit = '30' } = args;

		if(!token_address) {
			this.logger.error('Token address is required.', { args });
			throw new Error('Token address is required for fetch_token_price_history action');
		}

		try {
			this.logger.info(`Fetching price history for token ${ token_address } with resolution ${ resolution }...`);
			const priceHistory = await VybeService.getTokenOhlc(token_address, {
				resolution,
				timeStart: time_start,
				timeEnd: time_end,
				limit,
			});

			this.logger.info('Token price history received:', priceHistory);

			const result = {
				token: token_address,
				resolution,
				timeRange: {
					start: time_start || 'default',
					end: time_end || 'default',
				},
				priceData: priceHistory,
			};

			this.logger.success(`Completed ${ functionName } for ${ token_address }`);
			this.logger.exit(functionName);
			return result;
		} catch(error) {
			this.logger.error(`Failed in ${ functionName } for ${ token_address }`, error);
			this.logger.exit(functionName, { error: true });
			throw new Error(`Failed to fetch token price history: ${ error.message }`);
		}
	}

	/**
	 * Action: Fetch token holders data
	 */
	async actionFetchTokenHoldersData(args) {
		const functionName = 'actionFetchTokenHoldersData';
		this.logger.entry(functionName, { args });
		const { token_address, limit = '10', page = '1' } = args;

		if(!token_address) {
			this.logger.error('Token address is required.', { args });
			throw new Error('Token address is required for fetch_token_holders_data action');
		}

		try {
			this.logger.info(`Fetching token holders for ${ token_address }...`);
			const holdersData = await VybeService.getTopTokenHolders(token_address, {
				limit: parseInt(limit),
				page: parseInt(page),
			});

			this.logger.info('Token holders data received:', holdersData);

			const result = {
				token: token_address,
				page: parseInt(page),
				limit: parseInt(limit),
				holdersData: holdersData,
			};

			this.logger.success(`Completed ${ functionName } for ${ token_address }`);
			this.logger.exit(functionName);
			return result;
		} catch(error) {
			this.logger.error(`Failed in ${ functionName } for ${ token_address }`, error);
			this.logger.exit(functionName, { error: true });
			throw new Error(`Failed to fetch token holders data: ${ error.message }`);
		}
	}

	/**
	 * Action: Fetch wallet PnL
	 */
	async actionFetchWalletPnl(args) {
		const functionName = 'actionFetchWalletPnl';
		this.logger.entry(functionName, { args });
		const { wallet_address, days } = args;

		if(!wallet_address) {
			this.logger.error('Wallet address is required.', { args });
			throw new Error('Wallet address is required for fetch_wallet_pnl action');
		}

		try {
			this.logger.info(`Fetching PnL for wallet ${ wallet_address }...`);
			const pnlData = await VybeService.getWalletPnl(wallet_address, {
				days: days ? parseInt(days) : undefined,
			});

			this.logger.info('Wallet PnL data received:', pnlData);

			const result = {
				wallet: wallet_address,
				days: days ? parseInt(days) : 'all available data',
				pnlData: pnlData,
			};

			this.logger.success(`Completed ${ functionName } for ${ wallet_address }`);
			this.logger.exit(functionName);
			return result;
		} catch(error) {
			this.logger.error(`Failed in ${ functionName } for ${ wallet_address }`, error);
			this.logger.exit(functionName, { error: true });
			throw new Error(`Failed to fetch wallet PnL data: ${ error.message }`);
		}
	}

	/**
	 * Action: Fetch token transfers
	 */
	async actionFetchTokenTransfers(args) {
		const functionName = 'actionFetchTokenTransfers';
		this.logger.entry(functionName, { args });
		const {
			token_address,
			wallet_address,
			min_usd_amount,
			max_usd_amount,
			time_start,
			time_end,
			limit = '20',
			page = '1',
		} = args;

		if(!token_address) {
			this.logger.error('Token address is required.', { args });
			throw new Error('Token address is required for fetch_token_transfers action');
		}

		try {
			this.logger.info(`Fetching transfers for token ${ token_address }...`);
			const transfersData = await VybeService.getTokenTransfers({
				mintAddress: token_address,
				walletAddress: wallet_address,
				minUsdAmount: min_usd_amount,
				maxUsdAmount: max_usd_amount,
				timeStart: time_start,
				timeEnd: time_end,
				limit: parseInt(limit),
				page: parseInt(page),
			});

			this.logger.info('Token transfers data received:', transfersData);

			const result = {
				token: token_address,
				wallet: wallet_address || 'all wallets',
				amountRange: {
					min: min_usd_amount || 'no minimum',
					max: max_usd_amount || 'no maximum',
				},
				timeRange: {
					start: time_start || 'default',
					end: time_end || 'default',
				},
				page: parseInt(page),
				limit: parseInt(limit),
				transfersData: transfersData,
			};

			this.logger.success(`Completed ${ functionName } for ${ token_address }`);
			this.logger.exit(functionName);
			return result;
		} catch(error) {
			this.logger.error(`Failed in ${ functionName } for ${ token_address }`, error);
			this.logger.exit(functionName, { error: true });
			throw new Error(`Failed to fetch token transfers data: ${ error.message }`);
		}
	}

	/**
	 * Action: Fetch top tokens
	 */
	async actionFetchTopTokens(args) {
		const functionName = 'actionFetchTopTokens';
		this.logger.entry(functionName, { args });
		let { sort_by = 'marketCap', order = 'asc', limit = '10', page = '1' } = args;
		limit = 10;
		try {
			this.logger.info(`Fetching top tokens sorted by ${ sort_by } in ${ order } order...`);

			// Map to Vybe API parameters
			const sortParam = order.toLowerCase() === 'asc' ?
				{ sortByAsc: sort_by } :
				{ sortByDesc: sort_by };

			const tokensData = await VybeService.getTokensSummary({
				...sortParam,
				limit: parseInt(limit),
				page: parseInt(page),
			});

			this.logger.info('Top tokens data received:', tokensData);

			const result = {
				sortBy: sort_by,
				order,
				page: parseInt(page),
				limit: parseInt(limit),
				tokens: tokensData,
			};

			this.logger.success(`Completed ${ functionName }`);
			this.logger.exit(functionName);
			return result;
		} catch(error) {
			this.logger.error(`Failed in ${ functionName }`, error);
			this.logger.exit(functionName, { error: true });
			throw new Error(`Failed to fetch top tokens: ${ error.message }`);
		}
	}

	/**
	 * Action: Fetch program details
	 */
	async actionFetchProgramDetails(args) {
		const functionName = 'actionFetchProgramDetails';
		this.logger.entry(functionName, { args });
		const { program_id } = args;

		if(!program_id) {
			this.logger.error('Program ID is required.', { args });
			throw new Error('Program ID is required for fetch_program_details action');
		}

		try {
			this.logger.info(`Fetching details for program ${ program_id }...`);
			const programDetails = await VybeService.getProgramDetails(program_id);

			this.logger.info('Program details received:', programDetails);

			const result = {
				programId: program_id,
				details: programDetails,
			};

			this.logger.success(`Completed ${ functionName } for ${ program_id }`);
			this.logger.exit(functionName);
			return result;
		} catch(error) {
			this.logger.error(`Failed in ${ functionName } for ${ program_id }`, error);
			this.logger.exit(functionName, { error: true });
			throw new Error(`Failed to fetch program details: ${ error.message }`);
		}
	}

	/**
	 * Action: Fetch program active users
	 */
	async actionFetchProgramActiveUsers(args) {
		const functionName = 'actionFetchProgramActiveUsers';
		this.logger.entry(functionName, { args });
		const { program_id, days = '7', limit = '20' } = args;

		if(!program_id) {
			this.logger.error('Program ID is required.', { args });
			throw new Error('Program ID is required for fetch_program_active_users action');
		}

		try {
			this.logger.info(`Fetching active users for program ${ program_id } for the past ${ days } days...`);
			const activeUsersData = await VybeService.getProgramActiveUsers(program_id, {
				days: parseInt(days),
				limit: parseInt(limit),
			});

			this.logger.info('Program active users data received:', activeUsersData);

			const result = {
				programId: program_id,
				days: parseInt(days),
				limit: parseInt(limit),
				activeUsers: activeUsersData,
			};

			this.logger.success(`Completed ${ functionName } for ${ program_id }`);
			this.logger.exit(functionName);
			return result;
		} catch(error) {
			this.logger.error(`Failed in ${ functionName } for ${ program_id }`, error);
			this.logger.exit(functionName, { error: true });
			throw new Error(`Failed to fetch program active users: ${ error.message }`);
		}
	}

	/**
	 * Action: Fetch program TVL
	 */
	async actionFetchProgramTvl(args) {
		const functionName = 'actionFetchProgramTvl';
		this.logger.entry(functionName, { args });
		const { program_id, resolution = '1d' } = args;

		if(!program_id) {
			this.logger.error('Program ID is required.', { args });
			throw new Error('Program ID is required for fetch_program_tvl action');
		}

		try {
			this.logger.info(`Fetching TVL for program ${ program_id } with resolution ${ resolution }...`);
			const tvlData = await VybeService.getProgramTvlTimeSeries(program_id, {
				resolution,
			});

			this.logger.info('Program TVL data received:', tvlData);

			const result = {
				programId: program_id,
				resolution,
				tvlData: tvlData,
			};

			this.logger.success(`Completed ${ functionName } for ${ program_id }`);
			this.logger.exit(functionName);
			return result;
		} catch(error) {
			this.logger.error(`Failed in ${ functionName } for ${ program_id }`, error);
			this.logger.exit(functionName, { error: true });
			throw new Error(`Failed to fetch program TVL: ${ error.message }`);
		}
	}

	/**
	 * Action: Fetch program ranking
	 */
	async actionFetchProgramRanking(args) {
		const functionName = 'actionFetchProgramRanking';
		this.logger.entry(functionName, { args });
		const { limit = '20', page = '1' } = args;

		try {
			this.logger.info(`Fetching program ranking...`);
			const rankingData = await VybeService.getProgramRanking({
				limit: parseInt(limit),
				page: parseInt(page),
			});

			this.logger.info('Program ranking data received:', rankingData);

			const result = {
				page: parseInt(page),
				limit: parseInt(limit),
				ranking: rankingData,
			};

			this.logger.success(`Completed ${ functionName }`);
			this.logger.exit(functionName);
			return result;
		} catch(error) {
			this.logger.error(`Failed in ${ functionName }`, error);
			this.logger.exit(functionName, { error: true });
			throw new Error(`Failed to fetch program ranking: ${ error.message }`);
		}
	}

	/**
	 * Action: Fetch market info
	 */
	async actionFetchMarketInfo(args) {
		const functionName = 'actionFetchMarketInfo';
		this.logger.entry(functionName, { args });
		const { market_id, program_id } = args;

		if(!market_id) {
			this.logger.error('Market ID is required.', { args });
			throw new Error('Market ID is required for fetch_market_info action');
		}

		try {
			this.logger.info(`Fetching market info for ${ market_id }...`);
			// Using getPriceMarkets with filters as there isn't a direct getMarketInfo method
			const marketData = await VybeService.getPriceMarkets({
				programId: program_id,
				// Additional filtering would need to happen on the client side
			});

			// Filter for the specific market_id
			const marketInfo = marketData.data?.find(market => market.id === market_id) || null;

			this.logger.info('Market info received:', marketInfo);

			const result = {
				marketId: market_id,
				programId: program_id,
				marketInfo: marketInfo,
			};

			this.logger.success(`Completed ${ functionName } for ${ market_id }`);
			this.logger.exit(functionName);
			return result;
		} catch(error) {
			this.logger.error(`Failed in ${ functionName } for ${ market_id }`, error);
			this.logger.exit(functionName, { error: true });
			throw new Error(`Failed to fetch market info: ${ error.message }`);
		}
	}

	/**
	 * Action: Fetch pair OHLCV
	 */
	async actionFetchPairOhlcv(args) {
		const functionName = 'actionFetchPairOhlcv';
		this.logger.entry(functionName, { args });
		const {
			base_mint_address,
			quote_mint_address,
			program_id,
			resolution = '1d',
			time_start,
			time_end,
			limit = '30',
		} = args;

		if(!base_mint_address || !quote_mint_address) {
			this.logger.error('Base and quote mint addresses are required.', { args });
			throw new Error('Base and quote mint addresses are required for fetch_pair_ohlcv action');
		}

		try {
			this.logger.info(`Fetching OHLCV for pair ${ base_mint_address }/${ quote_mint_address }...`);
			const ohlcvData = await VybeService.getPairTradeOhlcv(base_mint_address, quote_mint_address, {
				programId: program_id,
				resolution,
				timeStart: time_start,
				timeEnd: time_end,
				limit: parseInt(limit),
			});

			this.logger.info('Pair OHLCV data received:', ohlcvData);

			const result = {
				baseMint: base_mint_address,
				quoteMint: quote_mint_address,
				programId: program_id,
				resolution,
				timeRange: {
					start: time_start || 'default',
					end: time_end || 'default',
				},
				limit: parseInt(limit),
				ohlcvData: ohlcvData,
			};

			this.logger.success(`Completed ${ functionName } for ${ base_mint_address }/${ quote_mint_address }`);
			this.logger.exit(functionName);
			return result;
		} catch(error) {
			this.logger.error(`Failed in ${ functionName } for ${ base_mint_address }/${ quote_mint_address }`, error);
			this.logger.exit(functionName, { error: true });
			throw new Error(`Failed to fetch pair OHLCV data: ${ error.message }`);
		}
	}

	/**
	 * Action: Analyze token trend
	 */
	async actionAnalyzeTokenTrend(args) {
		const functionName = 'actionAnalyzeTokenTrend';
		this.logger.entry(functionName, { args });
		const { token_address, timeframe = 'week', metrics = 'price,volume,holders' } = args;

		if(!token_address) {
			this.logger.error('Token address is required.', { args });
			throw new Error('Token address is required for analyze_token_trend action');
		}

		try {
			this.logger.info(`Analyzing trends for token ${ token_address } over ${ timeframe } timeframe...`);

			// Split metrics into array if it's a comma-separated string
			const metricsArray = typeof metrics === 'string' ? metrics.split(',').map(m => m.trim()) : [ metrics ];

			// Determine time parameters based on timeframe
			let days;
			let resolution;
			switch(timeframe.toLowerCase()) {
				case 'day':
					days = 1;
					resolution = '1h';
					break;
				case 'week':
					days = 7;
					resolution = '1d';
					break;
				case 'month':
					days = 30;
					resolution = '1d';
					break;
				default:
					days = 7; // Default to week
					resolution = '1d';
			}

			const now = Math.floor(Date.now() / 1000);
			const startTime = now - (days * 24 * 60 * 60);

			// Gather data based on requested metrics
			const dataPromises = [];
			const dataResults = {};

			// Get token details for any analysis
			dataPromises.push(
				VybeService.getTokenDetails(token_address)
					.then(data => {
						dataResults.tokenDetails = data;
						return data;
					}),
			);

			if(metricsArray.includes('price')) {
				dataPromises.push(
					VybeService.getTokenOhlc(token_address, {
						resolution,
						timeStart: startTime,
						limit: 50,
					}).then(data => {
						dataResults.priceData = data;
						return data;
					}),
				);
			}

			if(metricsArray.includes('volume')) {
				dataPromises.push(
					VybeService.getTokenVolumeTimeSeries(token_address, {
						startTime,
						interval: resolution,
						limit: 50,
					}).then(data => {
						dataResults.volumeData = data;
						return data;
					}),
				);
			}

			if(metricsArray.includes('holders')) {
				dataPromises.push(
					VybeService.getTokenHoldersTimeSeries(token_address, {
						startTime,
						interval: resolution,
						limit: 50,
					}).then(data => {
						dataResults.holdersData = data;
						return data;
					}),
				);
			}

			await Promise.all(dataPromises);

			// Now analyze the data
			const analysis = {
				token: token_address,
				tokenName: dataResults.tokenDetails?.name || 'Unknown',
				tokenSymbol: dataResults.tokenDetails?.symbol || 'Unknown',
				timeframe,
				metrics: metricsArray,
				summary: {},
				trends: {},
			};

			// Price analysis
			if(dataResults.priceData) {
				const prices = dataResults.priceData.data || [];
				if(prices.length >= 2) {
					const firstPrice = prices[0].close;
					const lastPrice = prices[prices.length - 1].close;
					const priceChange = lastPrice - firstPrice;
					const priceChangePercent = firstPrice > 0 ? (priceChange / firstPrice) * 100 : 0;

					analysis.summary.price = {
						start: firstPrice,
						end: lastPrice,
						change: priceChange,
						changePercent: priceChangePercent,
						trend: priceChangePercent > 0 ? 'up' : (priceChangePercent < 0 ? 'down' : 'stable'),
					};

					analysis.trends.price = prices.map(p => ({
						time: p.time,
						open: p.open,
						high: p.high,
						low: p.low,
						close: p.close,
					}));
				}
			}

			// Volume analysis
			if(dataResults.volumeData) {
				const volumes = dataResults.volumeData.data || [];
				if(volumes.length >= 2) {
					const volumeTotal = volumes.reduce((sum, v) => sum + (v.volume || 0), 0);
					const volumeAvg = volumeTotal / volumes.length;

					analysis.summary.volume = {
						total: volumeTotal,
						average: volumeAvg,
					};

					analysis.trends.volume = volumes.map(v => ({
						time: v.time,
						volume: v.volume,
					}));
				}
			}

			// Holders analysis
			if(dataResults.holdersData) {
				const holders = dataResults.holdersData.data || [];
				if(holders.length >= 2) {
					const firstHolders = holders[0].holders;
					const lastHolders = holders[holders.length - 1].holders;
					const holdersChange = lastHolders - firstHolders;
					const holdersChangePercent = firstHolders > 0 ? (holdersChange / firstHolders) * 100 : 0;

					analysis.summary.holders = {
						start: firstHolders,
						end: lastHolders,
						change: holdersChange,
						changePercent: holdersChangePercent,
						trend: holdersChangePercent > 0 ? 'growing' : (holdersChangePercent < 0 ? 'shrinking' : 'stable'),
					};

					analysis.trends.holders = holders.map(h => ({
						time: h.time,
						holders: h.holders,
					}));
				}
			}

			this.logger.success(`Completed trend analysis for ${ token_address }`);
			this.logger.exit(functionName);
			return analysis;
		} catch(error) {
			this.logger.error(`Failed in ${ functionName } for ${ token_address }`, error);
			this.logger.exit(functionName, { error: true });
			throw new Error(`Failed to analyze token trends: ${ error.message }`);
		}
	}

	// En conversation.service.js DENTRO de la clase ConversationService
	// En conversation.service.js DENTRO de la clase ConversationService

	/**
	 * Action: Recommend tokens (Implementación Corregida)
	 */
	async actionRecommendTokens(args) {
		const functionName = 'actionRecommendTokens';
		this.logger.entry(functionName, { args });
		// Make sure defaults are strings in case they're not provided in args
		const { criteria = 'volume', risk_level = 'medium', timeframe = 'short', limit = '5' } = args;

		try {
			this.logger.info(`Generating token recommendations based on ${ criteria } criteria with ${ risk_level } risk level...`);

			// Correct mapping to valid sort field
			let vybeSortField = 'marketCap'; // Default to marketCap
			const validSortFields = [ 'mintAddress', 'currentSupply', 'current_supply', 'marketCap', 'market_cap', 'name', 'price', 'price1d', 'price_1d', 'price7d', 'price_7d', 'symbol' ];

			if(criteria === 'growth') {
				// Use price1d or price7d (e.g., price1d for short term)
				vybeSortField = timeframe === 'short' ? 'price1d' : 'price7d';
			} else if(criteria === 'volume' || criteria === 'trending') {
				// 'volume_24h' is NOT valid, use 'marketCap' as a reasonable proxy
				vybeSortField = 'marketCap';
			} else if(validSortFields.includes(criteria)) {
				vybeSortField = criteria; // Allow other valid fields directly
			} else {
				this.logger.warn(`Recommendation criteria '${ criteria }' not mapped. Using default: ${ vybeSortField }`);
			}

			// Re-validate the final field for safety
			if(!validSortFields.includes(vybeSortField)) {
				this.logger.error(`The resolved sort field '${ vybeSortField }' is still invalid! Using 'marketCap'.`);
				vybeSortField = 'marketCap';
			}

			this.logger.info(`Mapped criteria '${ criteria }' to Vybe sort field '${ vybeSortField }'`);

			// Get initial list of tokens using the correct sort field
			const tokensResponse = await VybeService.getTokensSummary({
				limit: 50, // Get more to filter
				sortByDesc: vybeSortField, // <--- USING CORRECTED FIELD
			});

			const tokens = tokensResponse.data || [];
			if(tokens.length === 0) {
				this.logger.warn(`VybeService.getTokensSummary didn't return tokens to sort by ${ vybeSortField }. Cannot generate recommendations.`);
				// Return a valid result indicating no recommendations
				const emptyResult = {
					criteria,
					risk_level,
					timeframe,
					count: 0,
					recommendations: [],
					source: {
						api: 'Vybe Network',
						endpoint: 'getTokensSummary',
						timestamp: new Date().toISOString(),
						filters_applied: {
							sortBy: vybeSortField,
							risk_level,
							timeframe,
						},
					},
				};
				this.logger.exit(functionName, emptyResult);
				return emptyResult;
			}

			// FIX: RELAXED FILTERING CRITERIA FOR RISK LEVELS
			let filteredTokens = [];
			switch(risk_level.toLowerCase()) {
				case 'low':
					filteredTokens = tokens.filter(token => {
						const marketCap = token.marketCap || 0;
						const priceChange = Math.abs(token.price_change_24h || 0);
						const holders = token.holders || 0;
						// Relaxed criteria
						return marketCap > 100000 || holders > 100;
					});
					break;
				case 'medium':
					filteredTokens = tokens.filter(token => {
						const marketCap = token.marketCap || 0;
						const volume = token.volume_24h || 0;
						// Significantly relaxed criteria
						return marketCap > 10000 || volume > 1000;
					});
					break;
				case 'high':
					filteredTokens = tokens.filter(token => {
						// No filtering for high risk - include all tokens
						return true;
					});
					break;
				default:
					filteredTokens = tokens;
			}
			this.logger.info(`Tokens after risk filter '${ risk_level }': ${ filteredTokens.length }`);

			// FIX: FALLBACK MECHANISM - If no tokens after filtering, use the original list
			if(filteredTokens.length === 0) {
				this.logger.warn(`No tokens passed the '${ risk_level }' risk filter. Using fallback to return raw recommendations.`);
				filteredTokens = tokens.slice(0, parseInt(limit)); // Take top tokens by original sort criteria
			}

			// (Re-sorting logic by timeframe - NO CHANGES)
			if(filteredTokens.length > 0) {
				if(timeframe.toLowerCase() === 'short') {
					filteredTokens.sort((a, b) =>
						Math.abs(b.price_change_24h || 0) - Math.abs(a.price_change_24h || 0),
					);
					this.logger.info(`Re-sorted for 'short' timeframe based on price_change_24h`);
				} else if(timeframe.toLowerCase() === 'long') {
					filteredTokens.sort((a, b) => {
						const mcDiff = (b.marketCap || 0) - (a.marketCap || 0);
						if(mcDiff !== 0) return mcDiff;
						return (b.holders || 0) - (a.holders || 0);
					});
					this.logger.info(`Re-sorted for 'long' timeframe based on marketCap/holders`);
				}
			}

			// Take the requested limit
			const limitedRecommendations = filteredTokens.slice(0, parseInt(limit));
			this.logger.info(`Taking top ${ limitedRecommendations.length } recommendations based on limit.`);

			// IMPORTANTE: Definir la variable recommendations ANTES de usarla
			const recommendations = limitedRecommendations.map(token => {
				let reason = '';
				const priceChange1d = token.price_change_1d || 0;
				const priceChange7d = token.price_change_7d || 0;
				const volume24h = token.volume_24h || 0;
				const marketCap = token.marketCap || 0;

				if(criteria === 'volume' || criteria === 'trending') {
					reason = `Market Cap: $${ marketCap.toLocaleString() }, 24h Vol: $${ volume24h.toLocaleString() }, 1d Change: ${ priceChange1d.toFixed(2) }%`;
				} else if(criteria === 'growth') {
					const relevantChange = timeframe === 'short' ? priceChange1d : priceChange7d;
					reason = `Price Change (${ timeframe === 'short' ? '1d' : '7d' }): ${ relevantChange.toFixed(2) }%, Market Cap: $${ marketCap.toLocaleString() }`;
				} else if(criteria === 'marketCap' || criteria === 'market_cap') {
					reason = `Market Cap: $${ marketCap.toLocaleString() }, 1d Change: ${ priceChange1d.toFixed(2) }%`;
				} else {
					reason = `Based on criteria: ${ criteria } (Sorted by: ${ vybeSortField }), Market Cap: $${ marketCap.toLocaleString() }`;
				}

				return {
					name: token.name || 'Unknown',
					symbol: token.symbol || 'Unknown',
					address: token.mintAddress,
					price_usd: token.price || 0,
					volume_24h: volume24h,
					price_change_1d: priceChange1d,
					price_change_7d: priceChange7d,
					holders: token.holders || 0,
					marketCap: marketCap,
					reason: reason,
				};
			});

			const result = {
				criteria,
				risk_level,
				timeframe,
				count: recommendations.length,
				recommendations,
				source: {
					api: 'Vybe Network',
					endpoint: 'getTokensSummary',
					timestamp: new Date().toISOString(),
					filters_applied: {
						sortBy: vybeSortField,
						risk_level,
						timeframe,
					},
				},
			};

			this.logger.success(`Completed token recommendations with ${ recommendations.length } results`);
			this.logger.exit(functionName);
			return result;
		} catch(error) {
			this.logger.error(`Failed in ${ functionName }`, error);
			this.logger.exit(functionName, { error: true });
			// Propagate more informative error
			const errorMessage = error.message.includes('Vybe API request failed')
				? `Vybe API Error during token recommendations: ${ error.message }`
				: `Failed to generate token recommendations: ${ error.message }`;
			throw new Error(errorMessage);
		}
	}

	// --- ACCIÓN: Crear Alerta de Precio (Revisada) ---
	/**
	 * Action: Create price alert (Uses actionScheduleAlert internally)
	 * @param {number} userId - User ID.
	 * @param {number} chatId - Chat ID.
	 * @param {object} args - Arguments { token_symbol, condition_type, threshold_value, currency? }.
	 * @returns {Promise<object>} Result object containing alert details.
	 */
	async actionCreatePriceAlert(userId, chatId, args) {
		const functionName = 'actionCreatePriceAlert';
		this.logger.entry(functionName, { userId, chatId, args });

		// *** VALIDACIÓN MEJORADA ***
		const { token_symbol, condition_type, threshold_value, currency = 'USD' } = args;

		if(!token_symbol || typeof token_symbol !== 'string') {
			this.logger.error('Invalid or missing token_symbol.', { args });
			throw new Error('Token symbol (string) is required for create_price_alert action');
		}
		if(!condition_type || ![ 'price_above', 'price_below' ].includes(condition_type)) {
			this.logger.error('Invalid or missing condition_type.', { args });
			throw new Error('Condition type must be \'price_above\' or \'price_below\'');
		}
		const price = parseFloat(threshold_value);
		if(isNaN(price) || price <= 0) {
			this.logger.error('Invalid or missing threshold_value.', { args });
			throw new Error('Threshold value (positive number) is required');
		}
		if(typeof currency !== 'string' || currency.length === 0) {
			this.logger.warn('Invalid currency provided, defaulting to USD.', { currency });
			args.currency = 'USD'; // Correct the currency if invalid
		}
		// *** FIN VALIDACIÓN ***

		try {
			this.logger.info(`Attempting to create price alert for token ${ token_symbol } (${ condition_type } ${ price } ${ currency })...`);

			// NOTA: No se necesita buscar el token address aquí si el backend que procesa
			// la tarea programada puede mapear el SÍMBOLO (e.g., 'SOL') a la dirección.
			// Si el backend SÍ necesita la dirección, deberías buscarla aquí primero
			// usando VybeService.getTokensSummary o similar y filtrar por símbolo.
			// Por simplicidad, asumimos que el backend puede manejar el símbolo.

			// Crear la condición para la tarea programada
			const alertCondition = `token_symbol:${ token_symbol }|condition:${ condition_type }|threshold:${ price }|currency:${ currency }`;
			const taskName = `Price Alert: ${ token_symbol } ${ condition_type } ${ price } ${ currency }`;
			const alertMessage = `🔔 Price Alert Triggered! ${ token_symbol } is now ${ condition_type.replace('price_', '') } ${ price } ${ currency }.`;

			// Usar la acción existente para crear la tarea programada
			this.logger.info(`Scheduling task for price alert condition: ${ alertCondition }`);
			const scheduledTaskResult = await this.actionScheduleAlert(userId, chatId, {
				type: 'price_check', // Tipo de tarea más específico
				condition: alertCondition, // Condición estructurada
				message: alertMessage, // Mensaje para cuando se dispare
				// 'scheduled_for' es null aquí, la lógica de chequeo la hará el cron job
			});

			const result = {
				alert_created: true,
				task_id: scheduledTaskResult.taskId, // ID de la tarea programada
				token_symbol: token_symbol,
				condition_type: condition_type,
				threshold_value: price,
				currency: currency,
				status_message: `Price alert for ${ token_symbol } ${ condition_type.replace('price_', '') } ${ price } ${ currency } has been scheduled.`,
			};

			this.logger.success(`Successfully scheduled price alert task for ${ token_symbol }`, result);
			this.logger.exit(functionName, result);
			return result;

		} catch(error) {
			this.logger.error(`Failed in ${ functionName } for ${ token_symbol }`, error);
			this.logger.exit(functionName, { error: true });
			// Propagar el error de forma más específica si es posible
			if(error.message.includes('schedule alert')) {
				throw new Error(`Failed to schedule the price alert task: ${ error.message }`);
			}
			throw new Error(`Failed to create price alert for ${ token_symbol }: ${ error.message }`);
		}
	}

	/**
	 * Action: Get known accounts
	 */
	async actionGetKnownAccounts(args) {
		const functionName = 'actionGetKnownAccounts';
		this.logger.entry(functionName, { args });
		const { owner_address, labels, entity_name, limit = '10', page = '1' } = args;

		try {
			this.logger.info(`Fetching known accounts with filters...`);
			const accountsData = await VybeService.getKnownAccounts({
				ownerAddress: owner_address,
				labels,
				entityName: entity_name,
				limit: parseInt(limit),
				page: parseInt(page),
			});

			this.logger.info('Known accounts data received:', accountsData);

			const result = {
				ownerAddress: owner_address || 'all',
				labels: labels || 'all',
				entityName: entity_name || 'all',
				page: parseInt(page),
				limit: parseInt(limit),
				accounts: accountsData,
			};

			this.logger.success(`Completed ${ functionName }`);
			this.logger.exit(functionName);
			return result;
		} catch(error) {
			this.logger.error(`Failed in ${ functionName }`, error);
			this.logger.exit(functionName, { error: true });
			throw new Error(`Failed to fetch known accounts: ${ error.message }`);
		}
	}

	/**
	 * Action: Get wallet tokens time series
	 */
	async actionGetWalletTokensTimeSeries(args) {
		const functionName = 'actionGetWalletTokensTimeSeries';
		this.logger.entry(functionName, { args });
		const { wallet_address, days = '30' } = args;

		if(!wallet_address) {
			this.logger.error('Wallet address is required.', { args });
			throw new Error('Wallet address is required for get_wallet_tokens_time_series action');
		}

		try {
			this.logger.info(`Fetching token balances time series for wallet ${ wallet_address } for the past ${ days } days...`);
			const timeSeriesData = await VybeService.getWalletTokensTimeSeries(wallet_address, {
				days: parseInt(days),
			});

			this.logger.info('Wallet tokens time series data received:', timeSeriesData);

			const result = {
				wallet: wallet_address,
				days: parseInt(days),
				timeSeriesData: timeSeriesData,
			};

			this.logger.success(`Completed ${ functionName } for ${ wallet_address }`);
			this.logger.exit(functionName);
			return result;
		} catch(error) {
			this.logger.error(`Failed in ${ functionName } for ${ wallet_address }`, error);
			this.logger.exit(functionName, { error: true });
			throw new Error(`Failed to fetch wallet tokens time series: ${ error.message }`);
		}
	}

	/**
	 * Action: Get token transfers analysis
	 */
	async actionGetTokenTransfersAnalysis(args) {
		const functionName = 'actionGetTokenTransfersAnalysis';
		this.logger.entry(functionName, { args });
		const { token_address, time_window = '24h', min_amount = '0', analysis_type = 'volume' } = args;

		if(!token_address) {
			this.logger.error('Token address is required.', { args });
			throw new Error('Token address is required for get_token_transfers_analysis action');
		}

		try {
			this.logger.info(`Analyzing transfers for token ${ token_address } over ${ time_window } with minimum amount ${ min_amount }...`);

			// Convert time window to seconds
			let timeStart;
			const now = Math.floor(Date.now() / 1000);

			switch(time_window.toLowerCase()) {
				case '24h':
					timeStart = now - (24 * 60 * 60);
					break;
				case '7d':
					timeStart = now - (7 * 24 * 60 * 60);
					break;
				case '30d':
					timeStart = now - (30 * 24 * 60 * 60);
					break;
				default:
					// Default to 24 hours if not recognized
					timeStart = now - (24 * 60 * 60);
			}

			// Fetch transfers
			const transfersData = await VybeService.getTokenTransfers({
				mintAddress: token_address,
				minUsdAmount: min_amount,
				timeStart,
				limit: 200, // Get a good sample for analysis
			});

			const transfers = transfersData.data || [];

			// Prepare the analysis based on type
			let analysis = {};

			if(analysis_type.toLowerCase() === 'volume') {
				// Volume analysis: Total volume, average transaction size, trends
				const totalVolume = transfers.reduce((sum, t) => sum + (t.amount_usd || 0), 0);
				const avgTransactionSize = transfers.length > 0 ? totalVolume / transfers.length : 0;

				// Group by hour/day depending on time window
				const groupByPeriod = {};
				const periodFormat = time_window === '24h' ? 'hour' : 'day';

				transfers.forEach(t => {
					const date = new Date(t.block_time * 1000);
					const period = periodFormat === 'hour' ?
						`${ date.getFullYear() }-${ date.getMonth() + 1 }-${ date.getDate() } ${ date.getHours() }:00` :
						`${ date.getFullYear() }-${ date.getMonth() + 1 }-${ date.getDate() }`;

					if(!groupByPeriod[period]) {
						groupByPeriod[period] = {
							count: 0,
							volume: 0,
						};
					}

					groupByPeriod[period].count++;
					groupByPeriod[period].volume += (t.amount_usd || 0);
				});

				const volumeByPeriod = Object.entries(groupByPeriod).map(([ period, data ]) => ({
					period,
					count: data.count,
					volume: data.volume,
				})).sort((a, b) => a.period.localeCompare(b.period));

				analysis = {
					type: 'volume',
					totalVolume,
					transactionCount: transfers.length,
					avgTransactionSize,
					volumeByPeriod,
				};
			} else if(analysis_type.toLowerCase() === 'frequency') {
				// Frequency analysis: Transactions per period, active hours

				// Transactions by hour of day
				const hourlyDistribution = Array(24).fill(0);

				// Transactions by day of week (0 = Sunday, 6 = Saturday)
				const dailyDistribution = Array(7).fill(0);

				transfers.forEach(t => {
					const date = new Date(t.block_time * 1000);
					const hour = date.getHours();
					const day = date.getDay();

					hourlyDistribution[hour]++;
					dailyDistribution[day]++;
				});

				// Find peak hours/days
				const peakHour = hourlyDistribution.indexOf(Math.max(...hourlyDistribution));
				const peakDay = dailyDistribution.indexOf(Math.max(...dailyDistribution));

				// Map day index to name
				const dayNames = [ 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday' ];

				analysis = {
					type: 'frequency',
					transactionCount: transfers.length,
					averagePerDay: transfers.length / (time_window === '24h' ? 1 : (time_window === '7d' ? 7 : 30)),
					hourlyDistribution,
					dailyDistribution,
					peakActivity: {
						hour: `${ peakHour }:00 - ${ peakHour }:59`,
						day: dayNames[peakDay],
					},
				};
			} else if(analysis_type.toLowerCase() === 'whales') {
				// Whale analysis: Identify largest holders/movers

				// Group by wallet address
				const walletActivity = {};

				transfers.forEach(t => {
					// Track both sending and receiving
					const senderAddress = t.sender_address || 'unknown';
					const receiverAddress = t.receiver_address || 'unknown';

					// Initialize if needed
					if(!walletActivity[senderAddress]) {
						walletActivity[senderAddress] = {
							sent: { count: 0, volume: 0 },
							received: { count: 0, volume: 0 },
						};
					}

					if(!walletActivity[receiverAddress]) {
						walletActivity[receiverAddress] = {
							sent: { count: 0, volume: 0 },
							received: { count: 0, volume: 0 },
						};
					}

					// Update activity
					walletActivity[senderAddress].sent.count++;
					walletActivity[senderAddress].sent.volume += (t.amount_usd || 0);

					walletActivity[receiverAddress].received.count++;
					walletActivity[receiverAddress].received.volume += (t.amount_usd || 0);
				});

				// Convert to array for sorting
				const walletsArray = Object.entries(walletActivity).map(([ address, data ]) => ({
					address,
					sentCount: data.sent.count,
					sentVolume: data.sent.volume,
					receivedCount: data.received.count,
					receivedVolume: data.received.volume,
					netFlow: data.received.volume - data.sent.volume,
					totalVolume: data.sent.volume + data.received.volume,
				}));

				// Sort by total volume to find whales
				const whales = walletsArray
					.sort((a, b) => b.totalVolume - a.totalVolume)
					.slice(0, 10); // Top 10 by volume

				analysis = {
					type: 'whales',
					transactionCount: transfers.length,
					uniqueWallets: walletsArray.length,
					topByVolume: whales,
					// Also include top net buyers/sellers
					topNetBuyers: [ ...walletsArray ]
						.sort((a, b) => b.netFlow - a.netFlow)
						.slice(0, 5),
					topNetSellers: [ ...walletsArray ]
						.sort((a, b) => a.netFlow - b.netFlow)
						.slice(0, 5),
				};
			}

			const result = {
				token: token_address,
				timeWindow: time_window,
				minAmount: min_amount,
				analysisType: analysis_type,
				transactionsAnalyzed: transfers.length,
				analysis: analysis,
			};

			this.logger.success(`Completed ${ functionName } for ${ token_address }`);
			this.logger.exit(functionName);
			return result;
		} catch(error) {
			this.logger.error(`Failed in ${ functionName } for ${ token_address }`, error);
			this.logger.exit(functionName, { error: true });
			throw new Error(`Failed to analyze token transfers: ${ error.message }`);
		}
	}

	/**
	 * Action: Get price prediction
	 */
	async actionGetPricePrediction(args) {
		const functionName = 'actionGetPricePrediction';
		this.logger.entry(functionName, { args });
		const { token_address, timeframe = '24h', confidence_level = 'medium' } = args;

		if(!token_address) {
			this.logger.error('Token address is required.', { args });
			throw new Error('Token address is required for get_price_prediction action');
		}

		try {
			this.logger.info(`Generating price prediction for token ${ token_address } for ${ timeframe } timeframe...`);

			// Get token details
			const tokenDetails = await VybeService.getTokenDetails(token_address);
			const tokenName = tokenDetails?.name || 'Unknown Token';
			const tokenSymbol = tokenDetails?.symbol || 'Unknown';
			const currentPrice = tokenDetails?.price_usd || 0;

			// Get historical price data
			let daysOfHistory;
			let predictionDays;

			switch(timeframe.toLowerCase()) {
				case '24h':
					daysOfHistory = 7; // Use 7 days of history for 24h prediction
					predictionDays = 1;
					break;
				case '7d':
					daysOfHistory = 30; // Use 30 days of history for 7d prediction
					predictionDays = 7;
					break;
				case '30d':
					daysOfHistory = 90; // Use 90 days of history for 30d prediction
					predictionDays = 30;
					break;
				default:
					daysOfHistory = 7;
					predictionDays = 1;
			}

			const now = Math.floor(Date.now() / 1000);
			const startTime = now - (daysOfHistory * 24 * 60 * 60);

			const priceHistory = await VybeService.getTokenOhlc(token_address, {
				resolution: '1d',
				timeStart: startTime,
				limit: daysOfHistory + 10, // Add buffer
			});

			const prices = priceHistory?.data || [];

			// Simple prediction model based on historical volatility and trend
			const priceValues = prices.map(p => p.close);

			// Calculate average price and standard deviation
			const avgPrice = priceValues.reduce((sum, p) => sum + p, 0) / priceValues.length;
			const variance = priceValues.reduce((sum, p) => sum + Math.pow(p - avgPrice, 2), 0) / priceValues.length;
			const stdDev = Math.sqrt(variance);

			// Calculate recent trend (recent days weighted more)
			let weightedTrend = 0;
			let weightSum = 0;

			for(let i = 1; i < priceValues.length; i++) {
				const dayChange = priceValues[i] - priceValues[i - 1];
				const weight = i; // More recent days have higher weight
				weightedTrend += dayChange * weight;
				weightSum += weight;
			}

			const dailyTrend = weightSum > 0 ? weightedTrend / weightSum : 0;

			// Adjust variance based on confidence level
			let varianceMultiplier;
			switch(confidence_level.toLowerCase()) {
				case 'low':
					varianceMultiplier = 2.0; // Wider range, less confident
					break;
				case 'medium':
					varianceMultiplier = 1.5;
					break;
				case 'high':
					varianceMultiplier = 1.0; // Narrower range, more confident
					break;
				default:
					varianceMultiplier = 1.5;
			}

			// Make prediction
			const predictedPrice = currentPrice + (dailyTrend * predictionDays);
			const rangeHigh = predictedPrice + (stdDev * varianceMultiplier);
			const rangeLow = predictedPrice - (stdDev * varianceMultiplier);

			// Calculate prediction confidence
			let confidence;
			if(prices.length < 5) {
				confidence = 'very low'; // Not enough data
			} else {
				const volatility = stdDev / avgPrice;
				if(volatility > 0.15) {
					confidence = 'low'; // High volatility
				} else if(volatility > 0.07) {
					confidence = 'medium';
				} else {
					confidence = 'high'; // Low volatility
				}
			}

			const result = {
				token: token_address,
				tokenName,
				tokenSymbol,
				currentPrice,
				timeframe,
				prediction: {
					predictedPrice: predictedPrice > 0 ? predictedPrice : 0, // Ensure non-negative
					rangeLow: rangeLow > 0 ? rangeLow : 0, // Ensure non-negative
					rangeHigh: rangeHigh > 0 ? rangeHigh : 0, // Ensure non-negative
					percentChange: currentPrice > 0 ? ((predictedPrice - currentPrice) / currentPrice) * 100 : 0,
					confidence,
					trend: dailyTrend > 0 ? 'upward' : (dailyTrend < 0 ? 'downward' : 'stable'),
				},
				disclaimer: 'This prediction is based on historical data and simple trend analysis. Cryptocurrency markets are highly volatile and unpredictable. This should not be considered financial advice.',
			};

			this.logger.success(`Completed price prediction for ${ tokenSymbol }`);
			this.logger.exit(functionName);
			return result;
		} catch(error) {
			this.logger.error(`Failed in ${ functionName } for ${ token_address }`, error);
			this.logger.exit(functionName, { error: true });
			throw new Error(`Failed to generate price prediction: ${ error.message }`);
		}
	}

	/**
	 * Action: Compare tokens (continued)
	 */
	async actionCompareTokens(args) {
		const functionName = 'actionCompareTokens';
		this.logger.entry(functionName, { args });
		const { token_addresses, metrics = 'price,volume,holders,volatility', timeframe = '7d' } = args;

		if(!token_addresses) {
			this.logger.error('Token addresses are required.', { args });
			throw new Error('Token addresses are required for compare_tokens action');
		}

		try {
			// Parse token addresses from string if needed
			const tokenAddressList = typeof token_addresses === 'string' ?
				token_addresses.split(',').map(addr => addr.trim()) :
				Array.isArray(token_addresses) ? token_addresses : [ token_addresses ];

			if(tokenAddressList.length < 2) {
				throw new Error('At least two token addresses are required for comparison');
			}

			this.logger.info(`Comparing ${ tokenAddressList.length } tokens across ${ metrics } metrics...`);

			// Parse metrics
			const metricsArray = typeof metrics === 'string' ?
				metrics.split(',').map(m => m.trim().toLowerCase()) :
				Array.isArray(metrics) ? metrics.map(m => m.toLowerCase()) : [ metrics.toLowerCase() ];

			// Determine time parameters based on timeframe
			let daysLookback;
			let resolution;

			switch(timeframe.toLowerCase()) {
				case '24h':
					daysLookback = 2; // Look back 2 days for 24h comparison
					resolution = '1h';
					break;
				case '7d':
					daysLookback = 10; // Look back 10 days for 7d comparison
					resolution = '1d';
					break;
				case '30d':
					daysLookback = 45; // Look back 45 days for 30d comparison
					resolution = '1d';
					break;
				default:
					daysLookback = 10;
					resolution = '1d';
			}

			const now = Math.floor(Date.now() / 1000);
			const startTime = now - (daysLookback * 24 * 60 * 60);

			// Collect data for each token
			const tokensData = [];

			for(const tokenAddress of tokenAddressList) {
				const tokenData = { address: tokenAddress };

				// Get basic token details
				const tokenDetails = await VybeService.getTokenDetails(tokenAddress);
				tokenData.name = tokenDetails?.name || 'Unknown';
				tokenData.symbol = tokenDetails?.symbol || 'Unknown';
				tokenData.currentPrice = tokenDetails?.price_usd || 0;
				tokenData.volume24h = tokenDetails?.volume_24h || 0;
				tokenData.priceChange24h = tokenDetails?.price_change_24h || 0;

				// Get additional metrics as needed
				if(metricsArray.includes('holders')) {
					try {
						const holdersData = await VybeService.getTopTokenHolders(tokenAddress, { limit: 1 });
						tokenData.totalHolders = holdersData?.total || 0;
					} catch(e) {
						this.logger.warn(`Failed to fetch holders data for ${ tokenAddress }: ${ e.message }`);
						tokenData.totalHolders = 0;
					}
				}

				if(metricsArray.includes('price') || metricsArray.includes('volatility')) {
					try {
						const priceHistory = await VybeService.getTokenOhlc(tokenAddress, {
							resolution,
							timeStart: startTime,
							limit: 100,
						});

						const prices = priceHistory?.data || [];
						tokenData.priceHistory = prices;

						// Calculate volatility if needed
						if(metricsArray.includes('volatility') && prices.length > 1) {
							const returns = [];
							for(let i = 1; i < prices.length; i++) {
								const prev = prices[i - 1].close;
								const current = prices[i].close;
								if(prev > 0) {
									returns.push((current - prev) / prev);
								}
							}

							if(returns.length > 0) {
								const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
								const variance = returns.reduce((sum,
									r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
								tokenData.volatility = Math.sqrt(variance);
							} else {
								tokenData.volatility = 0;
							}
						}
					} catch(e) {
						this.logger.warn(`Failed to fetch price history for ${ tokenAddress }: ${ e.message }`);
						tokenData.priceHistory = [];
						tokenData.volatility = 0;
					}
				}

				tokensData.push(tokenData);
			}

			// Prepare comparison results
			const comparison = {
				tokens: tokensData.map(t => ({
					address: t.address,
					name: t.name,
					symbol: t.symbol,
				})),
				timeframe,
				metrics: {},
				rankings: {},
			};

			// Add metrics data
			metricsArray.forEach(metric => {
				comparison.metrics[metric] = {};

				switch(metric) {
					case 'price':
						comparison.metrics.price = tokensData.map(t => ({
							token: t.symbol,
							currentPrice: t.currentPrice,
							priceChange24h: t.priceChange24h,
							priceHistory: t.priceHistory?.map(p => ({
								time: p.time,
								price: p.close,
							})) || [],
						}));

						// Rank by price performance
						comparison.rankings.price = [ ...tokensData ]
							.sort((a, b) => b.priceChange24h - a.priceChange24h)
							.map(t => ({ token: t.symbol, value: t.priceChange24h }));
						break;

					case 'volume':
						comparison.metrics.volume = tokensData.map(t => ({
							token: t.symbol,
							volume24h: t.volume24h,
						}));

						// Rank by volume
						comparison.rankings.volume = [ ...tokensData ]
							.sort((a, b) => b.volume24h - a.volume24h)
							.map(t => ({ token: t.symbol, value: t.volume24h }));
						break;

					case 'holders':
						comparison.metrics.holders = tokensData.map(t => ({
							token: t.symbol,
							totalHolders: t.totalHolders,
						}));

						// Rank by holders
						comparison.rankings.holders = [ ...tokensData ]
							.sort((a, b) => b.totalHolders - a.totalHolders)
							.map(t => ({ token: t.symbol, value: t.totalHolders }));
						break;

					case 'volatility':
						comparison.metrics.volatility = tokensData.map(t => ({
							token: t.symbol,
							volatility: t.volatility,
							volatilityPercent: t.volatility * 100,
						}));

						// Rank by volatility (lower is better)
						comparison.rankings.volatility = [ ...tokensData ]
							.sort((a, b) => a.volatility - b.volatility)
							.map(t => ({ token: t.symbol, value: t.volatility }));
						break;
				}
			});

			// Add overall ranking based on composite score
			const scores = tokensData.map(t => {
				let score = 0;
				let factorsCount = 0;

				// Price change contribution (higher is better)
				if(t.priceChange24h !== undefined) {
					score += tokensData.indexOf(tokensData.sort((a,
						b) => b.priceChange24h - a.priceChange24h)[0]) === tokensData.indexOf(t) ? 3 :
						tokensData.indexOf(tokensData.sort((a,
							b) => b.priceChange24h - a.priceChange24h)[1]) === tokensData.indexOf(t) ? 2 : 1;
					factorsCount++;
				}

				// Volume contribution (higher is better)
				if(t.volume24h !== undefined) {
					score += tokensData.indexOf(tokensData.sort((a,
						b) => b.volume24h - a.volume24h)[0]) === tokensData.indexOf(t) ? 3 :
						tokensData.indexOf(tokensData.sort((a,
							b) => b.volume24h - a.volume24h)[1]) === tokensData.indexOf(t) ? 2 : 1;
					factorsCount++;
				}

				// Holders contribution (higher is better)
				if(t.totalHolders !== undefined) {
					score += tokensData.indexOf(tokensData.sort((a,
						b) => b.totalHolders - a.totalHolders)[0]) === tokensData.indexOf(t) ? 3 :
						tokensData.indexOf(tokensData.sort((a,
							b) => b.totalHolders - a.totalHolders)[1]) === tokensData.indexOf(t) ? 2 : 1;
					factorsCount++;
				}

				// Volatility contribution (lower is better for stability)
				if(t.volatility !== undefined) {
					score += tokensData.indexOf(tokensData.sort((a,
						b) => a.volatility - b.volatility)[0]) === tokensData.indexOf(t) ? 3 :
						tokensData.indexOf(tokensData.sort((a,
							b) => a.volatility - b.volatility)[1]) === tokensData.indexOf(t) ? 2 : 1;
					factorsCount++;
				}

				return {
					token: t.symbol,
					address: t.address,
					score: factorsCount > 0 ? score / factorsCount : 0,
				};
			});

			comparison.rankings.overall = scores.sort((a, b) => b.score - a.score);

			this.logger.success(`Completed comparison of ${ tokensData.length } tokens`);
			this.logger.exit(functionName);
			return comparison;
		} catch(error) {
			this.logger.error(`Failed in ${ functionName }`, error);
			this.logger.exit(functionName, { error: true });
			throw new Error(`Failed to compare tokens: ${ error.message }`);
		}
	}

	/**
	 * Action: Search the current chat's vector history.
	 * @param {object} args - Arguments { query, limit? }
	 * @param {number} chatId - The ID of the current chat.
	 * @returns {Promise<object>} Search results.
	 */
	async actionSearchChatHistory(args, chatId) {
		const functionName = 'actionSearchChatHistory';
		this.logger.entry(functionName, { args, chatId });
		const { query: searchQuery, limit = 3 } = args;

		if(!searchQuery) {
			this.logger.error('Search query is required.', { args });
			throw new Error('Query is required for search_chat_history action');
		}
		if(!chatId) {
			this.logger.error('Chat ID is required to target the correct collection.', { args });
			throw new Error('Internal Error: Chat ID missing for chat history search.');
		}

		// --- Lógica Clave: Encontrar la colección correcta del chat ---
		let targetCollectionName = null;
		try {
			this.logger.info(`Finding vector collection for chat ID: ${ chatId }`);
			const collections = await ChromaService.listCollections();
			// Busca colecciones que sigan el patrón 'chat-<chatId>-<timestamp>'
			const chatCollections = collections
				.filter(name => name.startsWith(`chat-${ chatId }-`))
				.sort() // Ordena para obtener la más reciente (asumiendo timestamp al final)
				.reverse(); // La más reciente primero

			if(chatCollections.length > 0) {
				targetCollectionName = chatCollections[0]; // Usa la más reciente
				this.logger.info(`Found target chat collection: '${ targetCollectionName }'`);
			} else {
				this.logger.warn(`No specific vector collection found for chat ${ chatId }. Cannot perform history search.`);
				// Decide cómo manejar esto: ¿error o resultado vacío?
				// Devolver resultado vacío es más seguro para el flujo.
				return {
					query: searchQuery,
					collection_searched: `chat-${ chatId }-* (Not Found)`,
					results: [],
					info: 'No indexed conversation history found for this chat yet.',
				};
			}
		} catch(error) {
			this.logger.error(`Failed to list or find Chroma collections for chat ${ chatId }`, error);
			throw new Error(`Failed to access chat history collection: ${ error.message }`);
		}
		// --- Fin Lógica Clave ---

		try {
			this.logger.info(`Performing semantic search in '${ targetCollectionName }' for query: "${ searchQuery }" (limit ${ limit })`);

			// (El resto es similar a actionSemanticQuery pero con la colección correcta)
			this.logger.info('Instantiating OpenAI embedding function for chat search...');
			if(!process.env.OPENAI_API_KEY) {
				throw new Error('Missing OpenAI API Key configuration.');
			}
			const embeddingFunction = new OpenAIEmbeddingFunction({
				openai_api_key: process.env.OPENAI_API_KEY,
				openai_model: ConversationService.TOKEN_EMBEDDING_MODEL, // Asegúrate que coincida con el usado en createSearchCollection
			});

			this.logger.info(`Getting collection '${ targetCollectionName }' with embedding function...`);
			const chromaCollection = await ChromaService.client.getCollection({
				name: targetCollectionName,
				embeddingFunction: embeddingFunction,
			});

			this.logger.info('Executing ChromaDB query on chat history...');
			const results = await chromaCollection.query({
				queryTexts: [ searchQuery ],
				nResults: parseInt(limit) || 3,
				include: [ 'documents', 'metadatas', 'distances' ],
			});
			this.logger.info('Raw Chroma query results received from chat history.');

			let formattedResults = [];
			if(results && results.ids && results.ids.length > 0 && results.ids[0].length > 0) {
				const count = results.ids[0].length;
				formattedResults = results.ids[0].map((id, i) => ({
					id: id,
					snippet: results.documents?.[0]?.[i] ?? null, // Renombrar 'document' a 'snippet' es más claro
					metadata: results.metadatas?.[0]?.[i] ?? null,
					relevance_score: 1 - (results.distances?.[0]?.[i] ?? 1), // Convertir distancia a score (0 a 1)
				}));
				this.logger.info(`Chat history query found ${ count } relevant snippets.`);
				this.logger.info('Formatted chat history results:', formattedResults);
			} else {
				this.logger.info('Chat history query returned no results.');
			}

			const finalResult = {
				query: searchQuery,
				collection_searched: targetCollectionName,
				limit: parseInt(limit) || 3,
				results: formattedResults,
			};

			this.logger.success(`Chat history search completed successfully.`);
			this.logger.exit(functionName);
			return finalResult;

		} catch(error) {
			this.logger.error(`Failed during chat history semantic query in '${ targetCollectionName }': ${ error.message }`, error);
			this.logger.exit(functionName, { error: true });
			throw new Error(`Failed to search chat history: ${ error.message }`);
		}
	}

	async _getMemoryItemByKey(chatId, key) {
		const functionName = '_getMemoryItemByKey';
		this.logger.entry(functionName, { chatId, key });
		try {
			const memoryItem = await this.prisma.memoryItem.findUnique({
				where: { chat_key_unique: { chatId, key } },
			});

			if(!memoryItem) {
				this.logger.info(`Memory item with key '${ key }' not found for chat ${ chatId }.`);
				this.logger.exit(functionName, { found: false });
				// Devolver un objeto estándar indicando que no se encontró
				return {
					key: key,
					value: null,
					found: false,
					message: `No value found for '${ key }'.`,
				};
			}

			let parsedValue = memoryItem.value;
			try {
				if(memoryItem.type === 'json') {
					parsedValue = JSON.parse(memoryItem.value);
				} else if(memoryItem.type === 'number') {
					const num = parseFloat(memoryItem.value);
					// Solo parsea si es un número válido, si no, mantenlo como string
					if(!isNaN(num)) parsedValue = num;
				} else if(memoryItem.type === 'boolean') {
					parsedValue = memoryItem.value.toLowerCase() === 'true';
				}
			} catch(e) {
				this.logger.warn(`Failed to parse value for memory item key '${ key }' (type: ${ memoryItem.type }). Returning as string.`, e);
				parsedValue = memoryItem.value; // Fallback a string si falla el parseo
			}

			const result = {
				key: memoryItem.key,
				value: parsedValue, // Devuelve el valor parseado
				type: memoryItem.type,
				found: true,
				last_modified: memoryItem.modified.toISOString(),
			};
			this.logger.success(`Retrieved memory item for key '${ key }'.`);
			this.logger.exit(functionName, { found: true, type: result.type });
			return result;

		} catch(error) {
			this.logger.error(`Error retrieving memory item for key '${ key }'`, error);
			this.logger.exit(functionName, { error: true });
			// Devolver un objeto de error consistente
			return {
				key: key,
				value: null,
				found: false,
				error: `Failed to retrieve memory item '${ key }': ${ error.message }`,
			};
		}
	}

	// --- NUEVAS FUNCIONES GET para Perfil Simple ---
	// Estas funciones simplemente llaman al helper con la clave correcta.
	// Aceptan 'args' por consistencia con executeAction, pero no lo usan.

	/**
	 * Action: Retrieve the user's stored name.
	 */
	async actionGetUserName(args, chatId) {
		const functionName = 'actionGetUserName';
		this.logger.entry(functionName, { chatId });
		const result = await this._getMemoryItemByKey(chatId, 'user_name');
		this.logger.exit(functionName, { found: result?.found });
		return result; // Devuelve el objeto { key, value, type, found, ... } o null/error
	}

	/**
	 * Action: Retrieve the user's stored risk tolerance.
	 */
	async actionGetRiskTolerance(args, chatId) {
		const functionName = 'actionGetRiskTolerance';
		this.logger.entry(functionName, { chatId });
		const result = await this._getMemoryItemByKey(chatId, 'risk_tolerance');
		this.logger.exit(functionName, { found: result?.found });
		return result;
	}

	/**
	 * Action: Retrieve the user's stored investment timeframe.
	 */
	async actionGetInvestmentTimeframe(args, chatId) {
		const functionName = 'actionGetInvestmentTimeframe';
		this.logger.entry(functionName, { chatId });
		const result = await this._getMemoryItemByKey(chatId, 'investment_timeframe');
		this.logger.exit(functionName, { found: result?.found });
		return result;
	}

	/**
	 * Action: Retrieve the user's stored favorite tokens list.
	 */
	async actionGetFavoriteTokens(args, chatId) {
		const functionName = 'actionGetFavoriteTokens';
		this.logger.entry(functionName, { chatId });
		// El helper _getMemoryItemByKey ya se encarga de parsear el JSON
		const result = await this._getMemoryItemByKey(chatId, 'favorite_tokens');
		this.logger.exit(functionName, { found: result?.found });
		// Si se encontró, result.value será un array; si no, será null.
		return result;
	}

	/**
	 * Action: Retrieve the user's stored investment goals.
	 */
	async actionGetInvestmentGoals(args, chatId) {
		const functionName = 'actionGetInvestmentGoals';
		this.logger.entry(functionName, { chatId });
		const result = await this._getMemoryItemByKey(chatId, 'investment_goals');
		this.logger.exit(functionName, { found: result?.found });
		return result;
	}

	/**
	 * Action: Retrieve the user's stored trading experience level.
	 */
	async actionGetTradingExperience(args, chatId) {
		const functionName = 'actionGetTradingExperience';
		this.logger.entry(functionName, { chatId });
		const result = await this._getMemoryItemByKey(chatId, 'trading_experience');
		this.logger.exit(functionName, { found: result?.found });
		return result;
	}

	/**
	 * Action: Retrieve the user's stored notification preferences.
	 */
	async actionGetNotificationPreferences(args, chatId) {
		const functionName = 'actionGetNotificationPreferences';
		this.logger.entry(functionName, { chatId });
		// El helper _getMemoryItemByKey ya se encarga de parsear el JSON
		const result = await this._getMemoryItemByKey(chatId, 'notification_preferences');
		this.logger.exit(functionName, { found: result?.found });
		// Si se encontró, result.value será un objeto; si no, será null.
		return result;
	}

}

export default ConversationService;




