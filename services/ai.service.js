// ai.service.js
import 'dotenv/config';
import axios from 'axios';
import { promptTokensEstimate } from 'openai-chat-tokens';
import { groqModels, openAIModels, openRouterModels, perplexityModels } from '../assets/data/ai-models.js';
import UploadService from '#services/upload.service.js';
import { createLogger } from '#utils/logger.js';

class AIService {

	// Static logger instance for the service
	static logger = createLogger({
		name: 'AiService',
		level: 'error',
		files: false,  // Asegúrate de que esto esté activado para guardar en archivos
		console: false, // Mantén la salida de consola también por ahora
	});

	/**
	 * Genera una portada (cover image) usando la API de OpenAI (DALL-E),
	 * la descarga y la sube a DigitalOcean (UploadService).
	 * Retorna el Attachment creado.
	 */
	static async generateCoverImage(prompt, options = {}) {
		const functionName = 'generateCoverImage';
		this.logger.entry(functionName, { prompt: prompt?.substring(0, 50) + '...', options });

		const {
			size = '512x512',
			model = 'dall-e-2',
			n = 1,
			responseFormat = 'url',
		} = options;

		if(!prompt) {
			this.logger.error('Prompt is required for image generation.');
			throw new Error('Prompt de imagen requerido');
		}

		try {
			const endpoint = 'https://api.openai.com/v1/images/generations';
			const headers = {
				'Authorization': `Bearer ${ process.env.OPENAI_API_KEY }`, // Ensure key exists
				'Content-Type': 'application/json',
			};

			if(!process.env.OPENAI_API_KEY) {
				this.logger.error('OpenAI API Key is missing in environment variables.');
				throw new Error('OpenAI API Key not configured.');
			}

			const body = {
				prompt,
				model,
				n,
				size,
				response_format: responseFormat,
			};
			this.logger.debug('Sending image generation request:', { endpoint, model, size });
			this.logger.debug('Request body (prompt omitted for brevity):', {
				model,
				n,
				size,
				response_format: responseFormat,
			});

			const startTime = Date.now();
			this.logger.info(`Requesting image generation from ${ endpoint }...`);

			const response = await axios.post(endpoint, body, { headers });

			const endTime = Date.now();
			const duration = endTime - startTime;
			this.logger.info(`Image generation response received. Status: ${ response.status }. Duration: ${ duration }ms`);
			this.logger.debug('Raw OpenAI Image Response Data:', response.data);

			const imageData = response.data?.data;

			if(!imageData || imageData.length === 0) {
				this.logger.error('No image data array received from OpenAI.', { responseData: response.data });
				throw new Error('No se recibió URL de imagen de OpenAI');
			}

			// Assuming n=1, get the first image URL
			const imageUrl = imageData[0]?.url;

			if(!imageUrl) {
				this.logger.error('Could not extract image URL from OpenAI response.', { imageData });
				throw new Error('No se pudo extraer la URL de la imagen generada');
			}
			this.logger.info('Image URL extracted successfully.', { url: imageUrl.substring(0, 80) + '...' });

			this.logger.info('Uploading generated image URL via UploadService...');
			const attachment = await UploadService.createAttachmentFromUrl(imageUrl, {
				acl: 'public-read',
				metas: {
					aiService: 'OpenAI', // Changed from openaiEndpoint
					aiModel: model,
					aiSize: size,
					aiPrompt: prompt, // Be mindful if prompts can be very long or sensitive
					aiResponseTimeMs: duration, // Use calculated duration
					originalUrl: imageUrl,
				},
			});

			this.logger.success('Image generated and uploaded successfully.', { attachmentId: attachment?.id });
			this.logger.exit(functionName, { attachmentId: attachment?.id });
			return attachment;

		} catch(error) {
			// Log Axios errors specifically if possible
			if(error.response) {
				// The request was made and the server responded with a status code
				// that falls out of the range of 2xx
				this.logger.error(`Error generating image: OpenAI API responded with status ${ error.response.status }`, error.response.data);
			} else if(error.request) {
				// The request was made but no response was received
				this.logger.error('Error generating image: No response received from OpenAI.', error.request);
			} else {
				// Something happened in setting up the request that triggered an Error
				this.logger.error('Error generating image: Request setup failed.', error.message, error.stack);
			}
			// Replace previous console.error
			// console.error('❌ [AIService] Error generando imagen:', error);
			this.logger.exit(functionName, { error: true });
			// Rethrow a user-friendly error, but the detailed one is logged
			throw new Error('Error generating cover image: ' + (error.response?.data?.error?.message || error.message));
		}
	}

	/**
	 * Sends a message to the appropriate AI provider API.
	 */
	static async sendMessage(data) {
		const functionName = 'sendMessage';
		// Avoid logging full history/prompt in entry if potentially large/sensitive
		this.logger.entry(functionName, {
			model: data.model,
			systemLength: data.system?.length,
			promptLength: data.prompt?.length,
			historyLength: data.history?.length,
			stream: data.stream,
			toolsCount: data.tools?.length,
			responseFormat: data.responseFormat,
		});

		let {
			model,
			system = '',
			prompt,
			stream = false,
			history = [],
			temperature = 0.5,
			max_tokens, // Will be calculated if not provided
			top_p = 1,
			frequency_penalty = 0.0001,
			presence_penalty = 0,
			stop = '',
			tools = [],
			toolChoice,
			responseFormat = null, // Expects object like { type: "json_object" }
		} = data;

		if(!model) {
			this.logger.error('Missing required field: model');
			throw new Error('Missing field: model');
		}
		if(!prompt) {
			this.logger.error('Missing required field: prompt');
			throw new Error('Missing field: prompt');
		}

		try {
			// 1. Get model info (provider, auth, context window)
			this.logger.info('Step 1: Resolving model info...');
			const modelInfo = this.solveModelInfo(model); // Logs internally
			const { provider, contextWindow, authToken } = modelInfo;
			this.logger.info(`Model resolved: ${ model }, Provider: ${ provider }, Context: ${ contextWindow }`);

			// 2. Adjust content length if needed
			this.logger.info('Step 2: Adjusting content length for context window...');
			const adjusted = this.adjustContent(system, history, prompt, contextWindow); // Logs internally
			system = adjusted.system;
			history = adjusted.history;
			prompt = adjusted.prompt;
			this.logger.info('Content adjustment complete.');

			// 3. Build messages array
			this.logger.info('Step 3: Building messages array...');
			const messages = [
				{ role: 'system', content: system },
				...history,
				{ role: 'user', content: prompt },
			];
			this.logger.debug(`Built ${ messages.length } messages.`);

			// 4. Calculate max_tokens dynamically if not provided
			this.logger.info('Step 4: Calculating max_tokens...');
			const estimatedPromptTokens = this.estimateTokens(messages); // Logs internally
			let calculatedMaxTokens = contextWindow - estimatedPromptTokens - 10; // Subtract buffer (e.g., 10 tokens)
			if(calculatedMaxTokens < 1) calculatedMaxTokens = 100; // Ensure a minimum reasonable value

			let finalMaxTokens;
			if(typeof max_tokens === 'number' && max_tokens > 0) {
				finalMaxTokens = max_tokens;
				this.logger.info(`Using provided max_tokens: ${ finalMaxTokens }`);
			} else {
				finalMaxTokens = calculatedMaxTokens;
				this.logger.info(`Using calculated max_tokens: ${ finalMaxTokens } (Context: ${ contextWindow }, Prompt: ${ estimatedPromptTokens })`);
			}
			// Override if JSON mode is specified (as per original logic)
			if(responseFormat && responseFormat.type === 'json_object') {
				finalMaxTokens = 4096; // OpenAI's limit for JSON mode often implies this
				this.logger.info(`Response format is JSON, overriding max_tokens to ${ finalMaxTokens }`);
			}

			// 5. Construct the core request body
			this.logger.info('Step 5: Constructing request body...');
			const requestData = {
				model,
				messages,
				temperature,
				top_p,
				frequency_penalty,
				presence_penalty,
				stream,
				max_tokens: finalMaxTokens,
			};
			this.logger.debug('Core request data constructed.');

			// 6. Add tools if applicable (currently only for OpenAI)
			if(tools && tools.length > 0) {
				if(provider === 'openai') {
					this.logger.info('Step 6: Adding tools to request...');
					requestData.tools = tools;
					requestData.tool_choice = toolChoice || 'auto';
					this.logger.debug('Tools added:', { count: tools.length, choice: requestData.tool_choice });
				} else {
					this.logger.warn(`Tools provided but provider '${ provider }' does not support them in this implementation. Tools ignored.`);
				}
			} else {
				this.logger.info('Step 6: No tools provided or applicable.');
			}

			// 7. Add response_format if provided
			if(responseFormat) {
				this.logger.info('Step 7: Adding response_format to request...');
				requestData.response_format = responseFormat;
				this.logger.debug('response_format added:', responseFormat);
			} else {
				this.logger.info('Step 7: No response_format provided.');
			}

			// Add stop sequence if provided
			if(stop) {
				requestData.stop = stop;
				this.logger.debug('Stop sequence added:', stop);
			}

			// 8. Determine provider URL
			this.logger.info('Step 8: Resolving provider URL...');
			const url = this.solveProviderUrl(provider); // Logs internally
			this.logger.info(`Using provider URL: ${ url }`);

			// 9. Configure Axios (headers, streaming)
			this.logger.info('Step 9: Configuring Axios request...');
			const headers = {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${ authToken }`,
			};
			// Add specific headers for OpenRouter if needed
			if(provider === 'openrouter') {
				headers['HTTP-Referer'] = process.env.OPEN_ROUTER_REFERER || 'http://localhost'; // Replace with your site URL
				headers['X-Title'] = process.env.OPEN_ROUTER_TITLE || 'AI Service'; // Replace with your app name
				this.logger.debug('Added OpenRouter specific headers.');
			}

			const axiosConfig = { headers };
			if(stream) {
				axiosConfig.responseType = 'stream';
				this.logger.info('Axios configured for streaming response.');
			} else {
				this.logger.info('Axios configured for standard JSON response.');
			}
			this.logger.debug('Final Axios config ready.');
			this.logger.debug('Final Request Body (messages truncated):', {
				...requestData,
				tools: `[${ tools.length } messages]`,
				system: system,
			});

			// 10. Make the API call
			this.logger.info(`Step 10: Sending request to ${ provider } at ${ url }...`);
			const startTime = Date.now();
			const response = await axios.post(url, requestData, axiosConfig);
			const duration = Date.now() - startTime;

			// Handle response based on stream or not
			if(stream) {
				this.logger.success(`Stream request successful. Status: ${ response.status }. Duration: ${ duration }ms. Returning stream object.`);
				// Note: We don't have the full data here, just the stream
				this.logger.exit(functionName, { stream: true, status: response.status });
				return response; // Return the raw Axios response with the stream
			} else {
				this.logger.success(`Request successful. Status: ${ response.status }. Duration: ${ duration }ms.`);
				this.logger.debug('Response data:', response.data); // Log the actual data for non-stream
				this.logger.exit(functionName, {
					stream: false,
					status: response.status,
					responseId: response.data?.id,
				});
				return response.data;
			}

		} catch(error) {
			// Enhanced error logging from Axios errors
			if(error.response) {
				this.logger.error(`API Error: Provider responded with status ${ error.response.status }. URL: ${ error.config?.url }`, error.response.data);
				// Rethrow with more specific message if possible
				const apiErrorMessage = error.response?.data?.error?.message || JSON.stringify(error.response?.data);
				throw new Error(`Error processing request: API Error (${ error.response.status }): ${ apiErrorMessage }`);
			} else if(error.request) {
				this.logger.error(`API Error: No response received for request to ${ error.config?.url }`, error.message);
				throw new Error(`Error processing request: No response from API provider.`);
			} else {
				this.logger.error('API Error: Request setup or processing failed.', error.message, error.stack);
				throw new Error('Error processing request: ' + error.message);
			}
			// console.error('❌ [AIService] Error Response:', JSON.stringify(error.response?.data, null, 2)); // Replaced by logger
			// console.error('❌ [AIService] Error:', error.message); // Replaced by logger
			this.logger.exit(functionName, { error: true });
			// Error is re-thrown above with more context
		}
	}

	// ------------------------------------------------------------------
	//    Helper: Get Model Information
	// ------------------------------------------------------------------
	static solveModelInfo(model) {
		const functionName = 'solveModelInfo';
		this.logger.entry(functionName, { model });

		// Combine all known model definitions
		const allModels = [ ...openAIModels, ...perplexityModels, ...groqModels, ...openRouterModels ]; // Added OpenRouter
		const modelInfo = allModels.find(m => m.name === model);

		if(!modelInfo) {
			this.logger.error(`Model info not found for specified model: ${ model }`);
			throw new Error(`Model info not found for: ${ model }`);
		}
		this.logger.debug('Found model info:', modelInfo);

		let provider = '';
		let authToken = '';

		// Determine provider and auth token based on which array the model was found in
		if(openAIModels.some(m => m.name === model)) {
			provider = 'openai';
			authToken = process.env.OPENAI_API_KEY;
			this.logger.debug('Provider determined: openai');
		} else if(perplexityModels.some(m => m.name === model)) {
			provider = 'perplexity';
			authToken = process.env.PERPLEXITY_API_KEY;
			this.logger.debug('Provider determined: perplexity');
		} else if(groqModels.some(m => m.name === model)) {
			provider = 'groq';
			authToken = process.env.GROQ_API_KEY;
			this.logger.debug('Provider determined: groq');
		} else if(openRouterModels.some(m => m.name === model)) {
			provider = 'openrouter';
			authToken = process.env.OPEN_ROUTER_KEY;
			this.logger.debug('Provider determined: openrouter');
		} else {
			// This case should technically not be reached if modelInfo was found, but good for safety
			this.logger.error(`Provider could not be determined for model: ${ model }, although info was found.`);
			throw new Error(`Provider not found for model: ${ model }`);
		}

		if(!authToken) {
			this.logger.error(`Authentication token not found in environment variables for provider: ${ provider }. Checked corresponding ENV key.`);
			throw new Error(`Auth token not found for provider: ${ provider }`);
		}
		this.logger.debug(`Auth token found for provider ${ provider }.`);

		const contextWindow = modelInfo.contextWindow || 4096; // Default context window if not specified
		this.logger.info(`Using context window: ${ contextWindow }`);

		const result = { ...modelInfo, provider, authToken, contextWindow };
		this.logger.exit(functionName, { provider, contextWindow });
		return result;
	}

	// ------------------------------------------------------------------
	//    Helper: Get Provider API URL
	// ------------------------------------------------------------------
	static solveProviderUrl(provider) {
		const functionName = 'solveProviderUrl';
		this.logger.entry(functionName, { provider });
		let url = '';

		if(provider === 'openai') {
			url = 'https://api.openai.com/v1/chat/completions';
		} else if(provider === 'perplexity') {
			url = 'https://api.perplexity.ai/chat/completions';
		} else if(provider === 'groq') {
			url = 'https://api.groq.com/openai/v1/chat/completions';
		} else if(provider === 'openrouter') {
			url = 'https://openrouter.ai/api/v1/chat/completions';
		} else {
			this.logger.error(`Provider URL not defined for unsupported provider: ${ provider }`);
			throw new Error(`Provider not supported: ${ provider }`);
		}

		this.logger.info(`Resolved URL for provider ${ provider }: ${ url }`);
		this.logger.exit(functionName, { url });
		return url;
	}

	// ------------------------------------------------------------------
	//    Helper: Adjust Content Length for Context Window
	// ------------------------------------------------------------------
	static adjustContent(system, history, prompt, contextWindow) {
		const functionName = 'adjustContent';
		// Log initial lengths for context
		this.logger.entry(functionName, {
			systemLen: system.length,
			historyLen: history.length,
			promptLen: prompt.length,
			contextWindow,
		});

		const targetTokens = contextWindow - 50; // Leave a buffer (e.g., 50 tokens) for response and safety
		this.logger.debug(`Target tokens (including buffer): ${ targetTokens }`);

		let messagesForEstimation = [
			{ role: 'system', content: system },
			...history,
			{ role: 'user', content: prompt },
		];
		let currentTokens = this.estimateTokens(messagesForEstimation); // Logs internally
		this.logger.info(`Initial token estimate: ${ currentTokens }`);

		if(currentTokens <= targetTokens) {
			this.logger.info('Initial tokens are within the target limit. No adjustment needed.');
			this.logger.exit(functionName, { adjusted: false });
			return { system, history, prompt };
		}

		this.logger.warn(`Initial tokens (${ currentTokens }) exceed target (${ targetTokens }). Starting adjustment...`);

		let iteration = 0;
		const maxIterations = history.length + 2; // Max iterations: remove all history + try trimming system/prompt

		// Trim history first (oldest messages)
		while(currentTokens > targetTokens && history.length > 0) {
			iteration++;
			this.logger.debug(`Iteration ${ iteration }: Removing oldest history message. Current tokens: ${ currentTokens }`);
			history.shift(); // Remove the oldest message
			messagesForEstimation = [ { role: 'system', content: system }, ...history, {
				role: 'user',
				content: prompt,
			} ];
			currentTokens = this.estimateTokens(messagesForEstimation);
		}

		// If still too long, try trimming system prompt (if significantly long)
		if(currentTokens > targetTokens && system.length > 200) { // Only trim long system prompts
			iteration++;
			const tokensOver = currentTokens - targetTokens;
			const charsToRemove = Math.ceil(tokensOver * 4); // Approximate characters to remove
			const trimLength = Math.min(charsToRemove, system.length - 100); // Keep at least 100 chars
			if(trimLength > 0) {
				this.logger.debug(`Iteration ${ iteration }: Trimming system prompt by ${ trimLength } chars. Current tokens: ${ currentTokens }`);
				system = system.substring(0, system.length - trimLength);
				messagesForEstimation = [ { role: 'system', content: system }, ...history, {
					role: 'user',
					content: prompt,
				} ];
				currentTokens = this.estimateTokens(messagesForEstimation);
			}
		}

		// Finally, if still too long, trim the user prompt (as a last resort)
		if(currentTokens > targetTokens && prompt.length > 200) { // Only trim long user prompts
			iteration++;
			const tokensOver = currentTokens - targetTokens;
			const charsToRemove = Math.ceil(tokensOver * 4);
			const trimLength = Math.min(charsToRemove, prompt.length - 100); // Keep at least 100 chars
			if(trimLength > 0) {
				this.logger.debug(`Iteration ${ iteration }: Trimming user prompt by ${ trimLength } chars. Current tokens: ${ currentTokens }`);
				prompt = prompt.substring(0, prompt.length - trimLength);
				// No need to recalculate tokens again, this is the last step
			}
		}

		if(currentTokens > targetTokens) {
			this.logger.warn(`Content adjustment finished, but tokens (${ currentTokens }) might still exceed target (${ targetTokens }) after trimming history and potentially prompts.`);
		} else {
			this.logger.info(`Content adjustment finished. Final token estimate: ${ currentTokens }`);
		}

		this.logger.exit(functionName, {
			adjusted: true,
			finalSystemLen: system.length,
			finalHistoryLen: history.length,
			finalPromptLen: prompt.length,
			finalTokenEst: currentTokens,
		});
		return { system, history, prompt };
	}

	// ------------------------------------------------------------------
	//    Helper: Estimate Tokens
	// ------------------------------------------------------------------
	static estimateTokens(messages) {
		const functionName = 'estimateTokens';
		// Avoid logging entry/exit for this simple utility unless debugging
		// this.logger.entry(functionName, { messageCount: messages.length });
		try {
			const tokens = promptTokensEstimate({ messages });
			// this.logger.debug(`Estimated tokens: ${tokens}`);
			// this.logger.exit(functionName, { tokens });
			return tokens;
		} catch(error) {
			this.logger.warn(`Token estimation failed: ${ error.message }. Falling back to simple estimation.`, messages);
			// Fallback to simple character count / 4 as a rough estimate
			let charCount = 0;
			messages.forEach(msg => {
				charCount += msg.content?.length || 0;
			});
			const fallbackTokens = Math.ceil(charCount / 4);
			// this.logger.exit(functionName, { fallbackTokens });
			return fallbackTokens;
		}
	}
}

export default AIService;
