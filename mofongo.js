// test-chroma-query.js (o mofongo.js)
import 'dotenv/config';
import ChromaService from './services/chroma.service.js'; // Asegúrate de que la ruta sea correcta
// ¡Importa la función de embedding necesaria!
import { OpenAIEmbeddingFunction } from 'chromadb';

// --- Configuración ---
const COLLECTION_NAME = 'token_resolution';
const QUERY_TEXT = 'me interesa TRUMP';
const NUM_RESULTS = 5;
// Modelo de embedding que USAS para esta colección (importante que coincida)
const EMBEDDING_MODEL = 'text-embedding-3-small';
// ---------------------

function log(message, level = 'INFO') {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${level}] ${message}`);
}

async function runQueryTest() {
  log('--- INICIANDO PRUEBA DE QUERY EN CHROMA ---');

  try {
    log('Verificando conexión con ChromaDB...');
    const isHealthy = await ChromaService.checkServerHealth();
    if (!isHealthy) {
      throw new Error('El servidor ChromaDB no está respondiendo correctamente o las credenciales son inválidas.');
    }
    log('Conexión con ChromaDB verificada.', 'SUCCESS');

    // *** INICIO DEL CAMBIO ***
    // 1. Crear la instancia de la función de embedding
    log('Creando instancia de la función de embedding OpenAI...');
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY no encontrada en las variables de entorno.');
    }
    const embeddingFunction = new OpenAIEmbeddingFunction({
      openai_api_key: process.env.OPENAI_API_KEY,
      openai_model: EMBEDDING_MODEL,
    });
    log(`Instancia de embedding creada para el modelo: ${EMBEDDING_MODEL}.`, 'SUCCESS');

    // 2. Obtener la colección PASANDO la función de embedding
    //    Usamos directamente el cliente de ChromaService para más control
    log(`Intentando obtener la colección "${COLLECTION_NAME}" CON la función de embedding...`);
    const collection = await ChromaService.client.getCollection({
        name: COLLECTION_NAME,
        embeddingFunction: embeddingFunction // <-- ¡LA CLAVE ESTÁ AQUÍ!
    });
    log(`Colección "${collection.name}" obtenida exitosamente con función de embedding adjunta.`, 'SUCCESS');
    // *** FIN DEL CAMBIO ***

    log(`Realizando búsqueda en "${collection.name}" con el texto: "${QUERY_TEXT}"...`);
    // Ahora 'collection.query' debería funcionar porque 'collection' tiene la .embeddingFunction
    const results = await ChromaService.queryCollection( // O podrías llamar a collection.query directamente
      collection,
      [QUERY_TEXT],
      NUM_RESULTS,
      {},
      ['documents', 'metadatas', 'distances']
    );
    log('Búsqueda completada.', 'SUCCESS');

    log(`--- Resultados de la Búsqueda (Top ${NUM_RESULTS}) ---`);
    if (results && results.ids && results.ids.length > 0 && results.ids[0].length > 0) {
        // (El resto del código para imprimir resultados permanece igual)
        const count = results.ids[0].length;
        log(`Se encontraron ${count} resultados:`);
        for (let i = 0; i < count; i++) {
          log(`\nResultado #${i + 1}:`);
          log(`  ID: ${results.ids[0][i]}`);
          log(`  Distancia: ${results.distances ? results.distances[0][i] : 'N/A'}`);
          log(`  Documento: ${results.documents ? results.documents[0][i] : 'N/A'}`);
          log(`  Metadatos: ${results.metadatas ? JSON.stringify(results.metadatas[0][i], null, 2) : 'N/A'}`);
        }
    } else {
      log('No se encontraron resultados para la búsqueda.');
    }

  } catch (error) {
    log(`ERROR FATAL EN LA PRUEBA: ${error.message}`, 'ERROR');
    log(`Stack: ${error.stack}`, 'ERROR');
     if (error.response) {
        try {
          log(`Respuesta HTTP: ${error.response.status} ${error.response.statusText}`, 'ERROR');
          const responseBody = await error.response.text();
          log(`Cuerpo de respuesta: ${responseBody}`, 'ERROR');
        } catch (e) {
          log(`No se pudo obtener el cuerpo de la respuesta: ${e.message}`, 'ERROR');
        }
      }
  } finally {
    log('--- FIN DE LA PRUEBA DE QUERY ---');
  }
}

runQueryTest()
  .catch(err => {
    console.error("Error no capturado fuera de la función principal:", err);
    process.exit(1);
  });
