import 'dotenv/config';
import AIService from './services/ai.service.js';

// Importar mock de UploadService si es necesario para testing
// import UploadService from '../services/upload.service.js';
// jest.mock('../services/upload.service.js');

/**
 * Test para AIService con OpenAI
 * Este archivo contiene pruebas para todas las funciones de AIService:
 * - generateCoverImage
 * - sendMessage
 * - solveModelInfo
 * - solveProviderUrl
 * - adjustContent
 * - estimateTokens
 */

// Configuración de entorno para los tests
async function setupTest() {
  console.log('🧪 Configurando entorno de pruebas...');

  // Verificar que las variables de entorno necesarias estén definidas
  const requiredEnvVars = [
    'OPENAI_API_KEY'
  ];

  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  if (missingVars.length > 0) {
    console.warn(`⚠️ Faltan las siguientes variables de entorno: ${missingVars.join(', ')}`);
    console.warn('Los tests que requieran estas variables pueden fallar');
  }
}

// Tests para generateCoverImage
async function testGenerateCoverImage() {
  console.log('\n🧪 TEST: generateCoverImage');

  try {
    const prompt = 'Un hermoso paisaje de montañas al atardecer con un lago reflectante en primer plano';
    const options = {
      size: '512x512',
      model: 'dall-e-2',
      n: 1
    };

    console.log('📝 Datos de entrada:');
    console.log('- Prompt:', prompt);
    console.log('- Opciones:', options);

    const attachment = await AIService.generateCoverImage(prompt, options);

    console.log('✅ Test EXITOSO de generateCoverImage');
    console.log('📦 Resultado (Attachment):', attachment);
    return attachment;
  } catch (error) {
    console.error('❌ Test FALLIDO de generateCoverImage:', error.message);
    throw error;
  }
}

// Tests para sendMessage (OpenAI con GPT-4.1 Nano)
async function testSendMessageOpenAI() {
  console.log('\n🧪 TEST: sendMessage (OpenAI con GPT-4.1 Nano)');

  try {
    const data = {
      model: 'gpt-4.1-nano',
      system: 'Eres un asistente útil y amigable.',
      prompt: '¿Puedes explicarme brevemente qué es la inteligencia artificial?',
      temperature: 0.7,
      max_tokens: 500,
      stream: false
    };

    console.log('📝 Datos de entrada:');
    console.log(JSON.stringify(data, null, 2));

    const response = await AIService.sendMessage(data);

    console.log('✅ Test EXITOSO de sendMessage (OpenAI con GPT-4.1 Nano)');
    console.log('📦 Estructura de respuesta:');
    console.log(JSON.stringify(response, null, 2));
    return response;
  } catch (error) {
    console.error('❌ Test FALLIDO de sendMessage (OpenAI):', error.message);
    throw error;
  }
}

// Test para sendMessage con tools/function calling (GPT-4.1 Nano)
async function testSendMessageWithTools() {
  console.log('\n🧪 TEST: sendMessage con herramientas (function calling) usando GPT-4.1 Nano');

  try {
    const tools = [
      {
        type: "function",
        function: {
          name: "get_weather",
          description: "Obtiene el clima actual para una ubicación",
          parameters: {
            type: "object",
            properties: {
              location: {
                type: "string",
                description: "La ciudad y estado, por ejemplo: 'San Francisco, CA'"
              },
              unit: {
                type: "string",
                enum: ["celsius", "fahrenheit"],
                description: "Unidad de temperatura"
              }
            },
            required: ["location"]
          }
        }
      }
    ];

    const data = {
      model: 'gpt-4.1-nano',
      system: 'Eres un asistente útil especializado en información meteorológica.',
      prompt: '¿Cuál es el clima hoy en Madrid?',
      temperature: 0.7,
      tools: tools,
      toolChoice: "auto",
      stream: false
    };

    console.log('📝 Datos de entrada (con tools):');
    console.log(JSON.stringify(data, null, 2));

    const response = await AIService.sendMessage(data);

    console.log('✅ Test EXITOSO de sendMessage con tools');
    console.log('📦 Estructura de respuesta con function calling:');
    console.log(JSON.stringify(response, null, 2));
    return response;
  } catch (error) {
    console.error('❌ Test FALLIDO de sendMessage con tools:', error.message);
    throw error;
  }
}

// Test para sendMessage con JSON mode (GPT-4.1 Nano)
async function testSendMessageWithJsonMode() {
  console.log('\n🧪 TEST: sendMessage con JSON mode usando GPT-4.1 Nano');

  try {
    const data = {
      model: 'gpt-4.1-nano',
      system: 'Eres un asistente que responde exclusivamente en formato JSON.',
      prompt: 'Dame información sobre 3 países de Europa, incluyendo su capital, población y idioma oficial. Responde en JSON.',
      temperature: 0.7,
      responseFormat: { type: "json_object" },
      stream: false
    };

    console.log('📝 Datos de entrada (con responseFormat):');
    console.log(JSON.stringify(data, null, 2));

    const response = await AIService.sendMessage(data);

    console.log('✅ Test EXITOSO de sendMessage con JSON mode');
    console.log('📦 Estructura de respuesta en JSON mode:');
    console.log(JSON.stringify(response, null, 2));
    return response;
  } catch (error) {
    console.error('❌ Test FALLIDO de sendMessage con JSON mode:', error.message);
    throw error;
  }
}

// Test para sendMessage con streaming (GPT-4.1 Nano)
async function testSendMessageStreaming() {
  console.log('\n🧪 TEST: sendMessage con streaming usando GPT-4.1 Nano');

  try {
    const data = {
      model: 'gpt-4.1-nano',
      system: 'Eres un asistente útil y conciso.',
      prompt: 'Cuenta una historia corta sobre un robot.',
      temperature: 0.7,
      stream: true
    };

    console.log('📝 Datos de entrada (streaming):');
    console.log(JSON.stringify(data, null, 2));

    const stream = await AIService.sendMessage(data);

    console.log('✅ Test EXITOSO de sendMessage con streaming');
    console.log('📦 Objeto stream recibido:', typeof stream);
    console.log('Para consumir el stream, usarías algo como:');
    console.log(`
    stream.on('data', chunk => {
      const lines = chunk.toString().split('\\n').filter(line => line.trim() !== '');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.substring(6);
          if (data === '[DONE]') {
            console.log('Stream completado');
          } else {
            try {
              const parsed = JSON.parse(data);
              console.log(parsed.choices[0]?.delta?.content || '');
            } catch (e) {
              console.error('Error parseando chunk:', e);
            }
          }
        }
      }
    });
    `);

    return stream;
  } catch (error) {
    console.error('❌ Test FALLIDO de sendMessage con streaming:', error.message);
    throw error;
  }
}

// No incluimos tests para otros proveedores ya que nos enfocaremos solo en OpenAI con el modelo más económico

// Tests para métodos internos
async function testInternalMethods() {
  console.log('\n🧪 TEST: Métodos internos de AIService');

  try {
    // Test para solveModelInfo
    console.log('\n1️⃣ TEST: solveModelInfo');
    const modelInfo = AIService.solveModelInfo('gpt-4');
    console.log('📦 Resultado de solveModelInfo:');
    console.log(JSON.stringify(modelInfo, null, 2));

    // Test para solveProviderUrl
    console.log('\n2️⃣ TEST: solveProviderUrl');
    const url = AIService.solveProviderUrl('openai');
    console.log('📦 Resultado de solveProviderUrl:', url);

    // Test para estimateTokens
    console.log('\n3️⃣ TEST: estimateTokens');
    const messages = [
      { role: 'system', content: 'Eres un asistente útil.' },
      { role: 'user', content: 'Hola, ¿cómo estás?' },
      { role: 'assistant', content: 'Estoy bien, ¿en qué puedo ayudarte?' },
      { role: 'user', content: 'Cuéntame sobre la inteligencia artificial.' }
    ];
    const tokenCount = AIService.estimateTokens(messages);
    console.log('📦 Resultado de estimateTokens para los mensajes:', tokenCount);

    // Test para adjustContent
    console.log('\n4️⃣ TEST: adjustContent');
    const system = 'Eres un asistente muy útil y amigable que proporciona información detallada.';
    const history = [
      { role: 'user', content: 'Hola, ¿me puedes ayudar con un proyecto?' },
      { role: 'assistant', content: 'Claro, estaré encantado de ayudarte. ¿De qué trata tu proyecto?' },
      { role: 'user', content: 'Es sobre inteligencia artificial' },
      { role: 'assistant', content: 'Excelente tema. La inteligencia artificial es un campo fascinante. ¿Qué aspecto específico quieres explorar?' }
    ];
    const prompt = 'Necesito entender cómo funcionan los transformers en el procesamiento de lenguaje natural.';
    const contextWindow = 2000; // Valor pequeño para forzar ajustes

    const adjusted = AIService.adjustContent(system, [...history], prompt, contextWindow);
    console.log('📦 Resultado de adjustContent:');
    console.log('- System ajustado (longitud):', adjusted.system.length);
    console.log('- History ajustada (longitud):', adjusted.history.length);
    console.log('- Prompt ajustado (longitud):', adjusted.prompt.length);

    console.log('✅ Test EXITOSO de métodos internos');
    return { modelInfo, url, tokenCount, adjusted };
  } catch (error) {
    console.error('❌ Test FALLIDO de métodos internos:', error.message);
    throw error;
  }
}

// Función principal para ejecutar todos los tests
async function runAllTests() {
  console.log('🚀 INICIANDO TESTS DE AIService (Sólo OpenAI con GPT-4.1 Nano)');

  try {
    await setupTest();

    // Tests principales
    // await testGenerateCoverImage();
    await testSendMessageOpenAI();
    await testSendMessageWithTools();
    await testSendMessageWithJsonMode();
    await testSendMessageStreaming();

    // Tests de métodos internos
    await testInternalMethods();

    console.log('\n✅✅✅ TODOS LOS TESTS COMPLETADOS CON ÉXITO ✅✅✅');
  } catch (error) {
    console.error('\n❌❌❌ FALLOS EN LOS TESTS ❌❌❌');
    console.error('Error general:', error);
  }
}

// Ejecutar todos los tests
runAllTests();
