// live_test_conversation_service.js
import 'dotenv/config'; // Carga las variables de entorno para los servicios reales

// Importa las implementaciones REALES
import { PrismaClient } from '@prisma/client'; // Se conectará a tu DATABASE_URL
import AIService from './services/ai.service.js';       // Usará la configuración real de AI
import VybeService from './services/vybe.service.js';     // Usará la configuración real de Vybe
import ChromaService from './services/chroma.service.js'; // Usará la configuración real de Chroma
import ConversationService from './services/conversation.service.js'; // El servicio que estamos probando

// --- Helper para mostrar resultados de forma legible ---
function logResult(testName, result) {
    console.log(`\n--- ${testName} Result ---`);
    if (!result) {
        console.log("Result is undefined or null.");
        return;
    }
    try {
        console.log(`Chat ID: ${result.chat?.id ?? 'N/A'}`);
        console.log(`User Message ID: ${result.userMessage?.id ?? 'N/A'}, Text: "${result.userMessage?.text ?? 'N/A'}"`);
        // Asegúrate de que assistantMessage existe antes de acceder a sus propiedades
        const assistantText = result.assistantMessage?.text ?? 'N/A';
        console.log(`Assistant Message ID: ${result.assistantMessage?.id ?? 'N/A'}, Text: "${assistantText.substring(0, 150)}..."`);
        console.log(`Executed Actions Count: ${result.executedActions?.length ?? 0}`);
        if (result.executedActions?.length > 0) {
            console.log(`Executed Actions Names: ${result.executedActions.map(a => a.name).join(', ')}`);
        }
        console.log(`Structured Data Present: ${result.structuredData ? 'Yes' : 'No'}`);
        // Opcional: Loguear datos estructurados si existen (pueden ser grandes)
        // if (result.structuredData) {
        //    console.log('Structured Data:', JSON.stringify(result.structuredData, null, 2));
        // }
    } catch (e) {
        console.error("Error logging result parts:", e);
        console.log("Raw Result Object:", result); // Loguea el objeto crudo si falla el desglose
    } finally {
        console.log(`--- End ${testName} Result ---`);
    }
}

// --- Función Principal de Pruebas "En Vivo" ---
async function runLiveTests() {
    console.log('🚀 === INICIO PRUEBA EN VIVO === 🚀');
    console.warn('🚨 ¡ADVERTENCIA! Este script usa servicios y BD REALES. 🚨');
    console.warn('Asegura que tu .env esté configurado correctamente.');
    console.warn('Puede generar costos y escribirá datos reales.');

    let serviceInstance;
    try {
        // Instancia el servicio (se conectará a la BD real)
        serviceInstance = new ConversationService();
        console.log('✅ ConversationService instanciado.');
        // Opcional: verificar conexión a BD explícitamente
        // await serviceInstance.prisma.$connect();
        // console.log('✅ Prisma client conectado.');
        // await serviceInstance.prisma.$disconnect();
    } catch (error) {
        console.error('❌ Error al instanciar ConversationService o conectar Prisma:', error);
        console.error('👉 Verifica tu DATABASE_URL en .env y la accesibilidad de la BD.');
        return; // Detener si no se puede crear el servicio
    }

    // --- Parámetros de Prueba ---
    const testUserId = 1; // Usa un ID de usuario existente en tu BD
    let testChatId = null; // Empezar sin chat ID para crear uno nuevo

    // --- Caso de Prueba 1: Mensaje Simple (Probablemente sin herramientas) ---
    console.log('\n--- Caso de Prueba 1: Mensaje Simple ---');
    const message1 = "Hola, ¿cómo estás?"; // Mensaje en español
    try {
        console.log(`[Test 1] Llamando sendMessage: userId=${testUserId}, chatId=${testChatId}, message="${message1}"`);
        const result1 = await serviceInstance.sendMessage(testUserId, testChatId, message1, null);
        logResult("Caso de Prueba 1", result1);

        // Guarda el ID del chat para usarlo en la siguiente prueba
        if (result1?.chat?.id) {
            testChatId = result1.chat.id;
            console.log(`[Test 1] Chat creado/usado con ID: ${testChatId}. Se usará en la siguiente prueba.`);
        } else {
            console.error("[Test 1] No se pudo obtener un chat ID del resultado.");
            // Considera detener el script si el chat es esencial para las pruebas siguientes
        }
    } catch (error) {
        console.error(`❌ Falló Caso de Prueba 1: ${error.message}`);
        console.error("Stack Trace:", error.stack);
    }

    // --- Caso de Prueba 2: Mensaje que Probablemente Dispare Herramientas ---
    console.log('\n--- Caso de Prueba 2: Mensaje con Posible Herramienta ---');
    // !!! REEMPLAZA con una dirección REAL de token Solana !!!
    const realTokenAddress = process.env.TEST_SOLANA_TOKEN_ADDRESS || "So11111111111111111111111111111111111111112"; // SOL Envuelto como ejemplo
    if (!process.env.TEST_SOLANA_TOKEN_ADDRESS) {
        console.warn(`⚠️ Variable TEST_SOLANA_TOKEN_ADDRESS no definida en .env, usando ${realTokenAddress}.`);
    }
    const message2 = `Dame detalles del token Solana con dirección ${realTokenAddress}. Incluye info de holders.`;

    if (!testChatId) {
        console.warn("[Test 2] Omitiendo prueba porque no se obtuvo un chat ID válido del Caso 1.");
    } else {
        try {
            console.log(`[Test 2] Llamando sendMessage: userId=${testUserId}, chatId=${testChatId}, message="${message2}"`);
            const result2 = await serviceInstance.sendMessage(testUserId, testChatId, message2, null);
            logResult("Caso de Prueba 2", result2);

            // Verificaciones básicas (sin depender de texto exacto de IA)
            if (result2.executedActions?.length > 0) {
                console.log("✅ [Test 2] Se ejecutaron acciones (Herramientas).");
                // Verifica si la acción esperada está presente
                 if (result2.executedActions.some(a => a.name === 'fetch_token_data')) {
                    console.log("✅ [Test 2] La acción 'fetch_token_data' se ejecutó.");
                 } else {
                     console.warn("⚠️ [Test 2] Se ejecutaron acciones, pero 'fetch_token_data' no está entre ellas.");
                 }
            } else {
                console.warn("⚠️ [Test 2] No se ejecutaron acciones. Revisa la respuesta de la IA o la lógica de disparo de herramientas.");
            }
            if (result2.structuredData) {
                console.log("✅ [Test 2] Se retornaron datos estructurados del paso de síntesis.");
            } else if (result2.executedActions?.length > 0) {
                 console.warn("⚠️ [Test 2] Se ejecutaron acciones, pero no se retornaron datos estructurados. Revisa el paso de síntesis JSON.");
            }

        } catch (error) {
            console.error(`❌ Falló Caso de Prueba 2: ${error.message}`);
            console.error("Stack Trace:", error.stack);
        }
    }

    // --- Agrega más Casos de Prueba si es necesario ---
    // Ej. probar 'remember_info', 'semantic_query', errores, etc.

    console.log('\n🏁 === PRUEBA EN VIVO FINALIZADA === 🏁');
    console.warn('🧹 Revisa tu base de datos / ChromaDB por los datos creados y limpia si es necesario.');

     // Opcional: Desconectar Prisma explícitamente
    try {
        if (serviceInstance?.prisma?.$disconnect) {
            await serviceInstance.prisma.$disconnect();
            console.log("🔌 Prisma client desconectado.");
        }
    } catch (disconnectError) {
        console.warn("⚠️ No se pudo desconectar Prisma client:", disconnectError.message);
    }
}

// --- Ejecutar las pruebas en vivo ---
runLiveTests();
