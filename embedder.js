// generate-token-embeddings-fixed.js
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import ChromaService from './services/chroma.service.js';
import fs from 'fs/promises';

// Configuración fija
const BATCH_SIZE = 25; // Reducido para evitar sobrecargar la API
const COLLECTION_NAME = 'token_resolution';
const LOG_FILE = './token-embedding-logs.txt';
const RETRY_DELAY_MS = 2000; // Espera 2 segundos entre reintentos
const MAX_RETRIES = 3; // Máximo de reintentos por lote

// Inicializar Prisma
const prisma = new PrismaClient();

/**
 * Función para loggear a consola y archivo
 */
async function log(message, level = 'INFO') {
  const timestamp = new Date().toISOString();
  const formattedMessage = `[${timestamp}] [${level}] ${message}`;

  console.log(formattedMessage);

  try {
    await fs.appendFile(LOG_FILE, formattedMessage + '\n');
  } catch (error) {
    console.error(`Error al escribir en el log: ${error.message}`);
  }
}

/**
 * Genera texto descriptivo del token para el embedding
 */
function generateTokenText(token) {
  return `Token Name: ${token.name || 'Unknown'}. Symbol: ${token.symbol || 'Unknown'}. Address: ${token.address}. ${token.tags ? `Tags: ${token.tags}.` : ''} ${token.coingeckoId ? `CoinGecko ID: ${token.coingeckoId}.` : ''}`;
}

/**
 * Función mejorada para diagnosticar problemas de Chroma
 */
async function checkChromaConnection() {
  await log('Realizando diagnóstico detallado de Chroma...', 'DEBUG');

  // 1. Verificar salud general
  const isHealthy = await ChromaService.checkServerHealth();
  await log(`Salud general del servidor: ${isHealthy ? '✅ OK' : '❌ ERROR'}`, 'DEBUG');

  // 2. Intentar listar colecciones
  try {
    const collections = await ChromaService.listCollections();
    await log(`Colecciones existentes: ${collections.join(', ')}`, 'DEBUG');
  } catch (error) {
    await log(`Error al listar colecciones: ${error.message}`, 'ERROR');
    await log(`Stack: ${error.stack}`, 'ERROR');
  }

  // 3. Intentar crear una colección de prueba
  const testCollectionName = `test_${Date.now()}`;
  try {
    await log(`Intentando crear colección de prueba: ${testCollectionName}`, 'DEBUG');
    const testCollection = await ChromaService.createCollection(testCollectionName);
    await log(`Colección de prueba creada exitosamente: ${testCollection.name}`, 'DEBUG');

    // Intentar eliminar la colección de prueba
    try {
      await ChromaService.deleteCollection(testCollectionName);
      await log(`Colección de prueba eliminada exitosamente`, 'DEBUG');
    } catch (deleteError) {
      await log(`Error al eliminar colección de prueba: ${deleteError.message}`, 'WARN');
    }
  } catch (error) {
    await log(`Error al crear colección de prueba: ${error.message}`, 'ERROR');
    await log(`Stack: ${error.stack}`, 'ERROR');
  }

  return isHealthy;
}

/**
 * Añadir documento único para probar Chroma
 */
async function testAddSingleDocument(collection) {
  try {
    await log('Realizando prueba de inserción individual...', 'DEBUG');

    const testDoc = `Test document created at ${new Date().toISOString()}`;
    const testId = `test-doc-${Date.now()}`;
    const testMeta = { type: 'test', created: new Date().toISOString() };

    // Generar embedding para el documento de prueba
    const embedding = await ChromaService.generateEmbeddings([testDoc]);

    // Intentar añadir un solo documento
    await log(`Añadiendo documento de prueba con ID: ${testId}`, 'DEBUG');

    // Modificación: Añade un log para ver el objeto de colección
    await log(`Objeto colección: ${typeof collection} ${Object.keys(collection).join(', ')}`, 'DEBUG');

    await collection.add({
      ids: [testId],
      documents: [testDoc],
      metadatas: [testMeta],
      embeddings: embedding ? [embedding[0]] : undefined
    });

    await log('Documento de prueba añadido exitosamente', 'SUCCESS');
    return true;
  } catch (error) {
    await log(`Error en prueba de inserción: ${error.message}`, 'ERROR');
    await log(`Stack: ${error.stack}`, 'ERROR');
    return false;
  }
}

/**
 * Procesa un lote de tokens con reintentos
 */
async function processTokenBatch(tokens) {
  await log(`Procesando lote de ${tokens.length} tokens...`);

  let retryCount = 0;

  while (retryCount <= MAX_RETRIES) {
    try {
      // 1. Obtener colección Chroma
      await log('Obteniendo colección Chroma...');
      const collection = await ChromaService.getOrCreateCollection(COLLECTION_NAME);
      await log(`Usando colección: ${collection.name}`);

      // Prueba de diagnóstico - intentar añadir un solo documento
      if (retryCount > 0) {
        await log('Realizando prueba diagnóstica de inserción individual...', 'DEBUG');
        const testResult = await testAddSingleDocument(collection);
        if (!testResult) {
          await log('Prueba de inserción individual falló. Retrasando el proceso completo.', 'WARN');
          retryCount++;
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
          continue;
        }
      }

      // 2. Preparar datos para Chroma
      const documents = tokens.map(token => generateTokenText(token));
      const ids = tokens.map(token => `token-${token.address}`);
      const metadatas = tokens.map(token => ({
        token_name: token.name,
        token_symbol: token.symbol,
        token_address: token.address,
        decimals: token.decimals,
        coingecko_id: token.coingeckoId,
        tags: token.tags,
        indexed_at: new Date().toISOString(),
      }));

      // 3. Generar embeddings
      await log('Generando embeddings con OpenAI...');
      const embeddings = await ChromaService.generateEmbeddings(documents);
      await log(`Embeddings generados correctamente: ${embeddings.length}`, 'SUCCESS');

      // 4. Guardar en Chroma - MODIFICADO para usar addDocuments en lugar de upsertDocuments
      await log('Guardando embeddings en Chroma...');

      // Registra los tamaños
      await log(`Documentos: ${documents.length}, IDs: ${ids.length}, Embeddings: ${embeddings.length}, Metadatas: ${metadatas.length}`, 'DEBUG');

      // Aquí está el cambio clave - usar addDocuments en lugar de upsertDocuments
      await ChromaService.addDocuments(
        collection,
        documents,
        ids,
        embeddings,
        metadatas
      );

      await log(`Embeddings guardados en Chroma correctamente`, 'SUCCESS');

      // 5. Actualizar BD Prisma
      await log('Actualizando registros en base de datos...');

      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        await prisma.token.update({
          where: { id: token.id },
          data: {
            isEmbedded: true,
            embeddingId: ids[i],
            embeddedAt: new Date(),
            embeddingStatus: 'success',
            chromaCollection: COLLECTION_NAME,
          }
        });
      }
      await log(`Base de datos actualizada para ${tokens.length} tokens`, 'SUCCESS');

      return { success: true, count: tokens.length };

    } catch (error) {
      retryCount++;

      await log(`Error al procesar lote (intento ${retryCount}/${MAX_RETRIES+1}): ${error.message}`, 'ERROR');
      await log(`Stack: ${error.stack}`, 'ERROR');

      // Si tiene mensaje de respuesta HTTP, loguear para diagnóstico
      if (error.response) {
        try {
          await log(`Respuesta HTTP: ${error.response.status} ${error.response.statusText}`, 'ERROR');
          const responseBody = await error.response.text();
          await log(`Cuerpo de respuesta: ${responseBody}`, 'ERROR');
        } catch (e) {
          await log(`No se pudo obtener el cuerpo de la respuesta: ${e.message}`, 'ERROR');
        }
      }

      if (retryCount <= MAX_RETRIES) {
        const waitTime = RETRY_DELAY_MS * retryCount; // Aumenta el tiempo de espera con cada reintento
        await log(`Esperando ${waitTime}ms antes de reintentar...`, 'WARN');
        await new Promise(resolve => setTimeout(resolve, waitTime));

        // Realizar diagnóstico extendido en cada reintento
        await checkChromaConnection();
      } else {
        // Marcar tokens como fallidos después de agotar reintentos
        await log('Marcando tokens como fallidos en la base de datos...', 'WARN');

        for (const token of tokens) {
          await prisma.token.update({
            where: { id: token.id },
            data: {
              embeddingStatus: 'failed',
              embeddingError: error.message.substring(0, 1000), // Limitar longitud
            }
          });
        }

        return { success: false, error: error.message, count: 0 };
      }
    }
  }
}

/**
 * Función principal
 */
async function main() {
  // Iniciar archivo de log
  await fs.writeFile(LOG_FILE, `=== INICIO GENERACIÓN EMBEDDINGS: ${new Date().toISOString()} ===\n`);

  await log('=== INICIANDO GENERACIÓN DE EMBEDDINGS DE TOKENS ===');
  await log(`Configuración:`);
  await log(`- Tamaño de lote: ${BATCH_SIZE}`);
  await log(`- Colección Chroma: ${COLLECTION_NAME}`);
  await log(`- Reintentos máximos: ${MAX_RETRIES}`);

  try {
    // Verificar conexión con Chroma de manera exhaustiva
    await log('Verificando conexión con servidor Chroma...');
    const isHealthy = await checkChromaConnection();

    if (!isHealthy) {
      throw new Error('El servidor Chroma no está respondiendo correctamente');
    }

    await log('Conexión con Chroma establecida correctamente', 'SUCCESS');

    // Consultar tokens sin embedding o con error previo
    const whereClause = {
      AND: [
        // Tokens con nombre o símbolo no nulos
        {
          OR: [
            { NOT: { name: null } },
            { NOT: { symbol: null } }
          ]
        },
        // Tokens no embebidos o con error
        {
          OR: [
            { isEmbedded: false },
            { embeddingStatus: 'failed' }
          ]
        }
      ]
    };

    // Contar tokens a procesar
    const totalTokens = await prisma.token.count({ where: whereClause });
    await log(`Total de tokens a procesar: ${totalTokens}`);

    if (totalTokens === 0) {
      await log('No hay tokens para procesar. Finalizando.', 'INFO');
      return;
    }

    // Procesar en lotes
    let processedCount = 0;
    let successCount = 0;
    let failedCount = 0;
    let batchNumber = 0;

    while (processedCount < totalTokens) {
      batchNumber++;
      const batchLimit = Math.min(BATCH_SIZE, totalTokens - processedCount);

      await log(`=== Procesando lote #${batchNumber} (${batchLimit} tokens) ===`);

      // Obtener tokens para este lote
      const tokens = await prisma.token.findMany({
        where: whereClause,
        take: batchLimit,
        skip: processedCount,
        orderBy: { id: 'asc' },
      });

      if (tokens.length === 0) {
        await log('No se encontraron más tokens. Finalizando.', 'INFO');
        break;
      }

      // Registrar IDs de tokens
      await log(`Tokens a procesar: ${tokens.map(t => t.id).join(', ')}`, 'DEBUG');
      await log(`Nombres de tokens: ${tokens.map(t => t.name || t.symbol || 'Desconocido').join(', ')}`, 'DEBUG');

      // Procesar lote
      const result = await processTokenBatch(tokens);

      // Actualizar contadores
      processedCount += tokens.length;
      if (result.success) {
        successCount += result.count;
      } else {
        failedCount += tokens.length;
      }

      await log(`Progreso: ${processedCount}/${totalTokens} (${Math.round(processedCount/totalTokens*100)}%)`);

      // Esperar entre lotes para no sobrecargar la API
      if (processedCount < totalTokens) {
        const delayMs = 2000; // 2 segundos entre lotes
        await log(`Esperando ${delayMs}ms antes del siguiente lote...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    // Resumen final
    await log('=== RESUMEN DE GENERACIÓN DE EMBEDDINGS ===');
    await log(`Total procesado: ${processedCount}/${totalTokens}`);
    await log(`Exitosos: ${successCount}`);
    await log(`Fallidos: ${failedCount}`);

  } catch (error) {
    await log(`ERROR FATAL: ${error.message}`, 'ERROR');
    await log(`Stack: ${error.stack}`, 'ERROR');
  } finally {
    await log('Cerrando conexiones...');
    await prisma.$disconnect();
    await log('=== FIN DE GENERACIÓN DE EMBEDDINGS ===');
  }
}

// Ejecutar script
main()
  .catch(async (error) => {
    console.error(`Error fatal no capturado: ${error.message}`);
    console.error(error.stack);
    await prisma.$disconnect();
    process.exit(1);
  });
