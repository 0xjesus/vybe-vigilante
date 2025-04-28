// chroma-service-enhanced.js
import 'dotenv/config';
import {ChromaClient, OpenAIEmbeddingFunction} from 'chromadb';

class ChromaService {
	static BASE_URL = process.env.CHROMA_SERVER_URL;

	/**
	 * NOTA IMPORTANTE:
	 * - Eliminamos `auth: { provider: 'basic', ... }`
	 * - Inyectamos cabecera de Authorization vía `fetchOptions`
	 */
	static client = new ChromaClient({
		path: ChromaService.BASE_URL,
		fetchOptions: {
			headers: {
				'Authorization': `Basic ${Buffer
					.from(process.env.CHROMA_SERVER_CREDENTIALS || '')
					.toString('base64')}`,
				'Content-Type': 'application/json',
			},
		},
	});

	/**
	 * Creates a new collection.
	 * @param {string} name - The name of the collection.
	 * @param {object} metadata - Metadata for the collection.
	 * @returns {Promise<object>} - The created collection.
	 */
	static async createCollection(name, metadata = {}) {
		// Construimos el payload sin metadata si está vacío
		const payload = {name};

		if (metadata && Object.keys(metadata).length > 0) {
			payload.metadata = metadata;
		}

		return await this.client.createCollection(payload);
	}

	/**
	 * Gets an existing collection.
	 * @param {string} name - The name of the collection.
	 * @returns {Promise<object>} - The retrieved collection.
	 */
	static async getCollection(name) {
		return await this.client.getCollection({name});
	}

	/**
	 * Gets or creates a collection.
	 * @param {string} name - The name of the collection.
	 * @param {object} metadata - Metadata for the collection.
	 * @returns {Promise<object>} - The got or created collection.
	 */
	static async getOrCreateCollection(name, metadata = {}) {
		try {
			console.log(`Intentando obtener colección: ${name}`);
			// Primero intentamos obtener la colección
			try {
				const existingCollection = await this.client.getCollection({name});
				console.log(`Colección existente obtenida: ${existingCollection.name}`);
				return existingCollection;
			} catch (error) {
				// Si no existe, la creamos
				if (error.message && (error.message.includes('not found') || error.message.includes('does not exist'))) {
					console.log(`Colección no encontrada, creando: ${name}`);
					// Construimos el payload sin metadata si está vacío
					const payload = {name};
					if (metadata && Object.keys(metadata).length > 0) {
						payload.metadata = metadata;
					}
					const newCollection = await this.client.createCollection(payload);
					console.log(`Nueva colección creada: ${newCollection.name}`);
					return newCollection;
				} else {
					// Otro tipo de error
					console.error(`Error al intentar obtener colección: ${error.message}`);
					throw error;
				}
			}
		} catch (error) {
			console.error(`Error en getOrCreateCollection para ${name}: ${error.message}`);
			// Añadimos más diagnóstico
			if (error.response) {
				try {
					const responseText = await error.response.text();
					console.error(`Respuesta HTTP: ${error.response.status} ${error.response.statusText}`);
					console.error(`Cuerpo: ${responseText}`);
				} catch (e) {
					console.error(`No se pudo obtener respuesta: ${e.message}`);
				}
			}
			throw error;
		}
	}

	/**
	 * Deletes a collection by name.
	 * @param {string} name - The name of the collection.
	 * @returns {Promise<void>}
	 */
	static async deleteCollection(name) {
		return await this.client.deleteCollection({name});
	}

	/**
	 * Lists all collections.
	 * ⚠️ Desde v0.6.0, devuelve sólo un array de strings con los nombres de colección.
	 * @returns {Promise<string[]>} - The list of collection names.
	 */
	static async listCollections() {
		return await this.client.listCollections();
	}

	/**
	 * Adds documents to a collection, optionally with associated embeddings and metadata.
	 * Modificado para mayor robustez y diagnóstico.
	 */
	static async addDocuments(collection, documents, ids, embeddings = [], metadatas = []) {
		if (
			documents.length !== ids.length ||
			(embeddings.length > 0 && documents.length !== embeddings.length)
		) {
			console.error(`Longitudes incorrectas: documents=${documents.length}, ids=${ids.length}, embeddings=${embeddings.length}`);
			throw new Error(
				'Mismatched input lengths: documents, ids, and embeddings (if provided) must have the same length.',
			);
		}

		// Asegurarse de que metadatas tiene la longitud correcta
		if (metadatas.length === 0) {
			metadatas = Array(documents.length).fill({});
		} else if (metadatas.length !== documents.length) {
			console.warn(`Ajustando longitud de metadatas: ${metadatas.length} => ${documents.length}`);
			// Expandir o truncar metadatas para que coincida con documents
			if (metadatas.length < documents.length) {
				metadatas = [...metadatas, ...Array(documents.length - metadatas.length).fill({})];
			} else {
				metadatas = metadatas.slice(0, documents.length);
			}
		}

		// Validar colección
		if (!collection || typeof collection.add !== 'function') {
			console.error(`Colección inválida: ${collection ? typeof collection : 'null'}`);
			throw new Error('Invalid collection object. Must have an add method.');
		}

		// Crear payload
		const documentPayload = {
			ids,
			documents,
			metadatas,
		};

		// Añadir embeddings si existen
		if (embeddings.length > 0) {
			documentPayload.embeddings = embeddings;
		}

		// Registro detallado para diagnóstico
		console.log(`Añadiendo ${documents.length} documentos a colección ${collection.name || 'desconocida'}`);

		try {
			// Intentar añadir en lotes más pequeños si hay muchos documentos
			if (documents.length > 25) {
				console.log(`Procesando en lotes más pequeños (${documents.length} total)`);
				// Dividir en lotes de 25
				const batchSize = 25;
				const results = [];

				for (let i = 0; i < documents.length; i += batchSize) {
					const batchEnd = Math.min(i + batchSize, documents.length);
					console.log(`Procesando lote ${i}-${batchEnd}`);

					const batchPayload = {
						ids: ids.slice(i, batchEnd),
						documents: documents.slice(i, batchEnd),
						metadatas: metadatas.slice(i, batchEnd),
					};

					if (embeddings.length > 0) {
						batchPayload.embeddings = embeddings.slice(i, batchEnd);
					}

					const batchResult = await collection.add(batchPayload);
					results.push(batchResult);

					// Esperar un poco entre lotes
					if (batchEnd < documents.length) {
						await new Promise(resolve => setTimeout(resolve, 500));
					}
				}

				console.log(`Completados ${results.length} lotes`);
				return results;
			} else {
				// Procesar todo junto si es un lote pequeño
				return await collection.add(documentPayload);
			}
		} catch (error) {
			console.error(`Error en addDocuments: ${error.message}`);
			// Log del payload para diagnóstico
			console.error(`Payload: ${JSON.stringify({
				collectionName: collection.name,
				documentCount: documents.length,
				idSample: ids.slice(0, 2),
				metadataSample: metadatas.slice(0, 2),
			})}`);

			// Verificar respuesta HTTP
			if (error.response) {
				try {
					const responseText = await error.response.text();
					console.error(`Respuesta HTTP: ${error.response.status} ${error.response.statusText}`);
					console.error(`Cuerpo: ${responseText}`);
				} catch (e) {
					console.error(`No se pudo obtener respuesta: ${e.message}`);
				}
			}

			throw error;
		}
	}

	/**
	 * Upserts documents to a collection with associated metadata and embeddings.
	 * Modificado para usar addDocuments internamente y evitar problemas con upsert.
	 */
	static async upsertDocuments(
		collection,
		documents,
		ids,
		embeddings = [],
		metadatas = [],
	) {
		// En lugar de usar upsert, que puede causar problemas, usaremos add
		// y manejaremos los errores de IDs duplicados si es necesario
		try {
			console.log(`Usando addDocuments en lugar de upsert para ${documents.length} documentos`);
			return await this.addDocuments(collection, documents, ids, embeddings, metadatas);
		} catch (error) {
			// Si el error es de IDs duplicados, podríamos implementar otra estrategia
			if (error.message && error.message.includes('duplicate')) {
				console.warn('Se detectaron IDs duplicados. Implementando estrategia alternativa...');

				// Aquí podríamos implementar una estrategia para eliminar y volver a añadir
				// o para actualizar manualmente, pero por simplicidad en este caso
				// simplemente relanzamos el error
				throw new Error(`IDs duplicados detectados: ${error.message}`);
			} else {
				// Cualquier otro error
				throw error;
			}
		}
	}

	/**
	 * Queries a collection.
	 */
	static async queryCollection(
		collection,
		queryTexts,
		nResults = 10,
		where = {},
		include = ['documents', 'metadatas', 'distances'],
	) {
		const payload = {queryTexts, nResults, include};
		if (where && Object.keys(where).length > 0) {
			payload.where = where;
		}
		return await collection.query(payload);
	}

	/**
	 * Deletes documents from a collection.
	 */
	static async deleteDocuments(collection, ids = [], where = {}) {
		const payload = {};
		if (ids && ids.length > 0) {
			payload.ids = ids;
		}
		if (where && Object.keys(where).length > 0) {
			payload.where = where;
		}
		return await collection.delete(payload);
	}

	/**
	 * Gets documents from a collection.
	 */
	static async getDocuments(
		collection,
		ids = [],
		where = {},
		include = ['documents', 'metadatas'],
	) {
		const payload = {include};
		if (ids && ids.length > 0) {
			payload.ids = ids;
		}
		if (where && Object.keys(where).length > 0) {
			payload.where = where;
		}
		return await collection.get(payload);
	}

	/**
	 * Peeks into a collection to see a limited number of items.
	 */
	static async peekCollection(collection, limit = 10) {
		return await collection.peek({limit});
	}

	/**
	 * Counts the number of items in a collection.
	 */
	static async countItems(collection) {
		return await collection.count();
	}

	/**
	 * Modifies a collection's metadata or name.
	 */
	static async modifyCollection(collection, newName = null, newMetadata = {}) {
		return await collection.modify({
			name: newName,
			metadata: newMetadata,
		});
	}

	/**
	 * Generates embeddings for a list of text documents using a specified embedding model.
	 * Mejorado para mayor robustez y mejor manejo de errores.
	 */
	static async generateEmbeddings(
		texts,
		integration = 'openai',
		model = 'text-embedding-3-small',
	) {
		console.log('=== generateEmbeddings Debug Logs ===');
		// console.log('Input texts:', texts);
		console.log('Integration:', integration);
		console.log('Model:', model);

		if (!Array.isArray(texts)) {
			throw new Error('texts must be an array');
		}

		const validTexts = texts
			.filter(text => text != null)
			.map(text => String(text).trim())
			.filter(text => text.length > 0);

		if (validTexts.length === 0) {
			throw new Error('No valid texts provided for embedding generation');
		}

		// Log de longitud para referencia
		console.log(`Procesando ${validTexts.length} textos. Primer texto: "${validTexts[0].substring(0, 50)}..."`);

		switch (integration) {
			case 'openai':
				console.log('Creating OpenAI embedding function...');
				// Verificar API key
				if (!process.env.OPENAI_API_KEY) {
					throw new Error('OPENAI_API_KEY not found in environment variables');
				}

				// Creamos la función de embedding con reintentos
				const embeddingFunction = new OpenAIEmbeddingFunction({
					openai_api_key: process.env.OPENAI_API_KEY,
					openai_model: model,
				});

				// Implementar reintentos automáticos
				const maxRetries = 3;
				let lastError = null;

				for (let attempt = 1; attempt <= maxRetries; attempt++) {
					try {
						console.log(`Generando embeddings (intento ${attempt}/${maxRetries})...`);
						const embeddings = await embeddingFunction.generate(validTexts);
						console.log(`Embeddings generados exitosamente (${embeddings.length})`);
						return embeddings;
					} catch (error) {
						lastError = error;
						console.error(`Error en intento ${attempt} de generación de embeddings: ${error.message}`);

						// Ver si es un error de OpenAI que podría resolverse esperando
						if (error.message && (
							error.message.includes('rate limit') ||
							error.message.includes('timeout') ||
							error.message.includes('too many requests')
						)) {
							const waitTime = 1000 * Math.pow(2, attempt); // Retroceso exponencial
							console.log(`Esperando ${waitTime}ms antes de reintentar...`);
							await new Promise(resolve => setTimeout(resolve, waitTime));
						} else if (attempt === maxRetries) {
							// Error fatal, no volveremos a intentarlo
							throw error;
						} else {
							// Otros errores, esperamos un tiempo fijo
							await new Promise(resolve => setTimeout(resolve, 1000));
						}
					}
				}

				// Si llegamos aquí, todos los reintentos fallaron
				throw lastError || new Error('Failed to generate embeddings after multiple attempts');

			default:
				throw new Error(`Unsupported embedding integration: ${integration}`);
		}
	}

	/**
	 * Crea o recupera una colección Chroma con una función de embedding (por defecto "openai").
	 */
	static async createOrGetCollectionUsingEmbeddings(
		collectionName,
		integration = 'openai',
		model = 'text-embedding-3-small',
	) {
		const isHealthy = await this.checkServerHealth();
		if (!isHealthy) {
			throw new Error(
				'Chroma server is not responding correctly. Please check the server status and credentials.',
			);
		}

		let embeddingFunction;
		switch (integration.toLowerCase()) {
			case 'openai':
				embeddingFunction = new OpenAIEmbeddingFunction({
					openai_api_key: process.env.OPENAI_API_KEY,
					openai_model: model,
				});
				break;
			default:
				throw new Error(`Unsupported embedding integration: ${integration}`);
		}

		try {
			// Omitimos metadata si está vacío (por si tu server también exige no enviar metadata vacío)
			return await this.client.getOrCreateCollection({
				name: collectionName,
				embeddingFunction,
			});
		} catch (error) {
			if (error.code === 'already_exists') {
				return await this.client.getCollection({name: collectionName});
			} else {
				throw new Error(`Error creating/getting collection: ${error.message}`);
			}
		}
	}

	/**
	 * Verifica la salud del servidor Chroma.
	 */
	static async checkServerHealth() {
		console.log('=== Chroma Server Health Check ===');
		console.log('Server URL:', ChromaService.BASE_URL);
		console.log('Credentials present:', !!process.env.CHROMA_SERVER_CREDENTIALS);

		if (!process.env.CHROMA_SERVER_CREDENTIALS) {
			console.error('❌ CHROMA_SERVER_CREDENTIALS no está configurado en las variables de entorno');
			return false;
		}

		try {
			const credentials = Buffer
				.from(process.env.CHROMA_SERVER_CREDENTIALS)
				.toString('base64');

			console.log('Attempting connection to API v2...');
			const response = await fetch(`${ChromaService.BASE_URL}/api/v2`, {
				headers: {
					'Authorization': `Basic ${credentials}`,
					'Content-Type': 'application/json',
				},
			});

			const text = await response.text();
			console.log('HTTP Status:', response.status);
			console.log('HTTP Response:', text);

			if (response.ok) {
				console.log('✅ API v1 connection successful');
				return true;
			} else {
				console.error('❌ API connection failed with status:', response.status);
				return false;
			}
		} catch (error) {
			console.error('❌ Server check failed');
			console.error('Error type:', error.name);
			console.error('Error message:', error.message);

			// Verificar conectividad general
			try {
				await fetch('https://google.com');
				console.log('✅ Internet connection is working');
				console.error('❌ Problem is specific to Chroma server');
			} catch (netError) {
				console.error('❌ General network connectivity issues detected');
			}

			return false;
		}
	}
}

export default ChromaService;
