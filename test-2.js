import 'dotenv/config';
import ConversationService from './services/conversation.service.js';
import ChromaService from './services/chroma.service.js';
import chalk from 'chalk';
import fs from 'fs/promises';

// Constantes para pruebas
const TEST_USER_ID = 1;
const TEST_WALLET_ADDRESS = 'HFJEhqTUPKKWvhwVeQS5qjSP373kMUFpNuiqMMyXZ2Gr';
const TEST_TOKEN_ADDRESS = 'So11111111111111111111111111111111111111112'; // wSOL
// Direcciones adicionales para pruebas más exhaustivas
const INVALID_ADDRESS = 'Not4ValidAddressFormatXYZ123456789ABCDEF';
const EMPTY_WALLET = '7WdsT2KhFzpEzFZZoKtQ6CwRmwvXz8h4amsJN1W5ybZs'; // Cuenta con pocos o ningún token
const POPULAR_TOKEN = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // USDC en Solana

class EnhancedConversationTest {
  constructor() {
    console.log(chalk.cyan('🔍 Iniciando Test de Validación de Respuestas Basadas en Datos Reales'));
    this.service = new ConversationService();
    this.chatId = null;
    this.logFile = `conversation_test_${Date.now()}.log`;
    console.log(chalk.green(`✅ Test inicializado - Los logs detallados se guardarán en ${this.logFile}`));
  }

  // Método para guardar logs en archivo para análisis posterior
  async logToFile(message) {
    const timestamp = new Date().toISOString();
    const formattedMessage = `${timestamp}: ${message}\n`;
    await fs.appendFile(this.logFile, formattedMessage);
  }

  // Método principal para ejecutar todas las pruebas
  async runTests() {
    try {
      await this.logToFile('=== INICIO DE PRUEBAS DE VALIDACIÓN ===');

      // Verificar ambiente
      console.log(chalk.cyan('\n🔧 Verificando configuración del ambiente...'));
      if (!process.env.OPENAI_API_KEY || !process.env.VYBE_API_KEY) {
        throw new Error('API keys no configuradas correctamente');
      }
      console.log(chalk.green('✅ Variables de entorno verificadas'));

      // Pruebas de escenarios
      await this.testBasicConversation();
      await this.testAmbiguousQuery();
      await this.testInvalidAddress();
      await this.testComparisonBetweenTokens();
      await this.testHistoricalDataRequest();
      await this.testQueryWithoutContext();
      await this.testUserPreferencesWithConflictingInfo();
      await this.testChromaFallback();

      // Reporte final
      console.log(chalk.bgGreen.black('\n✅ TODAS LAS PRUEBAS COMPLETADAS'));
      await this.logToFile('=== FIN DE PRUEBAS DE VALIDACIÓN ===');

    } catch (error) {
      console.error(chalk.bgRed.white('\n❌ ERROR EN EJECUCIÓN DE PRUEBAS'));
      console.error(error);
      await this.logToFile(`ERROR: ${error.message}\n${error.stack}`);
    }
  }

  // Inicia conversación básica para el resto de pruebas
  async testBasicConversation() {
    console.log(chalk.cyan('\n🧪 Test 1: Conversación básica e inicialización'));

    try {
      const result = await this.service.sendMessage(
        TEST_USER_ID,
        null,
        'Hola, soy un nuevo usuario interesado en el ecosistema Solana. ¿Puedes ayudarme?',
        null
      );

      this.chatId = result.chat.id;
      console.log(chalk.green(`✅ Conversación iniciada con ID: ${this.chatId}`));
      await this.analyzeResponse(result, 'inicialización');

      return result;
    } catch (error) {
      console.error(chalk.red('❌ Error en conversación básica:'), error);
      throw error;
    }
  }

  // Prueba consulta ambigua para ver si el sistema pide aclaración
  async testAmbiguousQuery() {
    console.log(chalk.cyan('\n🧪 Test 2: Consulta ambigua - verificando solicitud de aclaración'));

    if (!this.chatId) {
      console.error(chalk.red('❌ No hay chat ID disponible para continuar las pruebas'));
      return null;
    }

    try {
      const result = await this.service.sendMessage(
        TEST_USER_ID,
        this.chatId,
        '¿Me puedes dar información sobre ese token?',
        null
      );

      console.log(chalk.green('✅ Respuesta a consulta ambigua recibida'));
      await this.analyzeResponse(result, 'consulta_ambigua');

      // Verificar si pidió aclaración
      const responseText = result.assistantMessage.text.toLowerCase();
      const isProbingForMoreInfo =
        responseText.includes('qué token') ||
        responseText.includes('podría indicarme') ||
        responseText.includes('a cuál token') ||
        responseText.includes('necesito más información');

      if (isProbingForMoreInfo) {
        console.log(chalk.green('✅ El sistema correctamente pidió aclaración ante consulta ambigua'));
      } else {
        console.log(chalk.yellow('⚠️ El sistema no pidió aclaración explícita ante consulta ambigua'));
      }

      return result;
    } catch (error) {
      console.error(chalk.red('❌ Error en test de consulta ambigua:'), error);
      throw error;
    }
  }

  // Prueba con dirección inválida
  async testInvalidAddress() {
    console.log(chalk.cyan('\n🧪 Test 3: Consulta con dirección inválida - verificando manejo de errores'));

    if (!this.chatId) return null;

    try {
      const result = await this.service.sendMessage(
        TEST_USER_ID,
        this.chatId,
        `¿Puedes decirme qué tokens hay en esta wallet: ${INVALID_ADDRESS}?`,
        null
      );

      console.log(chalk.green('✅ Respuesta a dirección inválida recibida'));
      await this.analyzeResponse(result, 'direccion_invalida');

      // Verificar respuesta a error
      const responseText = result.assistantMessage.text.toLowerCase();
      const hasErrorHandling =
        responseText.includes('no válida') ||
        responseText.includes('inválida') ||
        responseText.includes('formato incorrecto') ||
        responseText.includes('no pude obtener');

      if (hasErrorHandling) {
        console.log(chalk.green('✅ El sistema manejó correctamente la dirección inválida'));
      } else {
        console.log(chalk.yellow('⚠️ El sistema no indicó claramente que la dirección es inválida'));
      }

      return result;
    } catch (error) {
      console.error(chalk.red('❌ Error en test de dirección inválida:'), error);
      throw error;
    }
  }

  // Test de comparación entre tokens
  async testComparisonBetweenTokens() {
    console.log(chalk.cyan('\n🧪 Test 4: Solicitud de comparación entre tokens - verificando uso de datos reales'));

    if (!this.chatId) return null;

    try {
      const result = await this.service.sendMessage(
        TEST_USER_ID,
        this.chatId,
        `¿Puedes comparar el token wSOL (${TEST_TOKEN_ADDRESS}) con USDC (${POPULAR_TOKEN}) en términos de precio actual, volumen y capitalización de mercado?`,
        null
      );

      console.log(chalk.green('✅ Respuesta de comparación entre tokens recibida'));
      await this.analyzeResponse(result, 'comparacion_tokens');

      // Verificar si usó fetch_token_data para ambos tokens
      const actions = result.actions || [];
      const tokenDataActions = actions.filter(a => a.name === 'fetch_token_data');

      if (tokenDataActions.length >= 2) {
        console.log(chalk.green('✅ El sistema buscó datos para ambos tokens'));
      } else {
        console.log(chalk.yellow(`⚠️ El sistema sólo realizó ${tokenDataActions.length} consultas de token_data`));
      }

      return result;
    } catch (error) {
      console.error(chalk.red('❌ Error en test de comparación:'), error);
      throw error;
    }
  }

  // Test de solicitud de datos históricos
  async testHistoricalDataRequest() {
    console.log(chalk.cyan('\n🧪 Test 5: Solicitud de datos históricos - verificando límites de conocimiento'));

    if (!this.chatId) return null;

    try {
      const result = await this.service.sendMessage(
        TEST_USER_ID,
        this.chatId,
        '¿Cuál fue el precio de SOL hace exactamente 2 años y 3 meses?',
        null
      );

      console.log(chalk.green('✅ Respuesta a solicitud de datos históricos recibida'));
      await this.analyzeResponse(result, 'datos_historicos');

      // Verificar si reconoce sus limitaciones
      const responseText = result.assistantMessage.text.toLowerCase();
      const acknowledgesLimitations =
        responseText.includes('no tengo acceso') ||
        responseText.includes('no puedo acceder') ||
        responseText.includes('limitación') ||
        responseText.includes('no dispongo');

      if (acknowledgesLimitations) {
        console.log(chalk.green('✅ El sistema reconoce correctamente sus limitaciones de datos históricos'));
      } else {
        console.log(chalk.yellow('⚠️ El sistema no expresó claramente sus limitaciones'));
      }

      return result;
    } catch (error) {
      console.error(chalk.red('❌ Error en test de datos históricos:'), error);
      throw error;
    }
  }

  // Test de consulta sin contexto suficiente
  async testQueryWithoutContext() {
    console.log(chalk.cyan('\n🧪 Test 6: Consulta sin contexto suficiente - verificando solicitud de información'));

    if (!this.chatId) return null;

    try {
      const result = await this.service.sendMessage(
        TEST_USER_ID,
        this.chatId,
        '¿Qué opinas sobre mi estrategia de inversión?',
        null
      );

      console.log(chalk.green('✅ Respuesta a consulta sin contexto recibida'));
      await this.analyzeResponse(result, 'sin_contexto');

      // Verificar si pide más información
      const responseText = result.assistantMessage.text.toLowerCase();
      const asksForContext =
        responseText.includes('no has compartido') ||
        responseText.includes('podrías compartir') ||
        responseText.includes('necesitaría más detalles') ||
        responseText.includes('no tengo información');

      if (asksForContext) {
        console.log(chalk.green('✅ El sistema correctamente pidió más información ante falta de contexto'));
      } else {
        console.log(chalk.yellow('⚠️ El sistema no solicitó explícitamente más contexto'));
      }

      return result;
    } catch (error) {
      console.error(chalk.red('❌ Error en test de consulta sin contexto:'), error);
      throw error;
    }
  }

  // Test de preferencias contradictorias
  async testUserPreferencesWithConflictingInfo() {
    console.log(chalk.cyan('\n🧪 Test 7: Preferencias contradictorias - verificando manejo de inconsistencias'));

    if (!this.chatId) return null;

    try {
      // Primero establecemos una preferencia
      await this.service.sendMessage(
        TEST_USER_ID,
        this.chatId,
        'Soy un inversor conservador que prefiere tokens estables y de bajo riesgo.',
        null
      );

      // Luego enviamos información contradictoria
      const result = await this.service.sendMessage(
        TEST_USER_ID,
        this.chatId,
        'Me gustaría invertir todo mi capital en tokens meme de alto riesgo para obtener 100x en poco tiempo.',
        null
      );

      console.log(chalk.green('✅ Respuesta a preferencias contradictorias recibida'));
      await this.analyzeResponse(result, 'preferencias_contradictorias');

      // Verificar si nota la contradicción
      const responseText = result.assistantMessage.text.toLowerCase();
      const notesContradiction =
        responseText.includes('mencionaste') ||
        responseText.includes('comentaste') ||
        responseText.includes('indicaste') ||
        responseText.includes('contradicción') ||
        responseText.includes('diferente');

      if (notesContradiction) {
        console.log(chalk.green('✅ El sistema detectó la contradicción en las preferencias'));
      } else {
        console.log(chalk.yellow('⚠️ El sistema no identificó la contradicción en preferencias'));
      }

      return result;
    } catch (error) {
      console.error(chalk.red('❌ Error en test de preferencias contradictorias:'), error);
      throw error;
    }
  }

  // Test de uso de ChromaDB para datos grandes
  async testChromaFallback() {
    console.log(chalk.cyan('\n🧪 Test 8: Uso de ChromaDB para datos grandes - verificando fallback a búsqueda vectorial'));

    if (!this.chatId) return null;

    try {
      // Primero creamos una colección con los datos de conversación
      console.log(chalk.cyan('  ► Creando colección con datos de conversación...'));
      await this.service.createSearchCollection(this.chatId);

      // Solicitamos datos que deberían provocar respuesta grande
      const result = await this.service.sendMessage(
        TEST_USER_ID,
        this.chatId,
        `¿Puedes analizar en detalle todos los principales tenedores de wSOL (${TEST_TOKEN_ADDRESS}) y explicar cómo podría afectar eso al precio?`,
        null
      );

      console.log(chalk.green('✅ Respuesta a consulta de datos grandes recibida'));
      await this.analyzeResponse(result, 'datos_grandes_chroma');

      // Verificar si usó Chroma
      const actions = result.actions || [];
      const tokenAction = actions.find(a => a.name === 'fetch_token_data');

      if (tokenAction &&
          tokenAction.result &&
          tokenAction.result.data &&
          tokenAction.result.data.chroma_data) {
        console.log(chalk.green('✅ Correctamente utilizó ChromaDB para almacenar datos grandes'));
        console.log(chalk.cyan(`  ► Datos almacenados en colección: ${tokenAction.result.data.chroma_data.collection_name}`));
      } else {
        console.log(chalk.yellow('⚠️ No se detectó uso de ChromaDB para datos grandes'));
      }

      return result;
    } catch (error) {
      console.error(chalk.red('❌ Error en test de ChromaDB para datos grandes:'), error);
      throw error;
    }
  }

  // Analiza una respuesta en detalle
  async analyzeResponse(result, testName) {
    const { assistantMessage, actions = [] } = result;

    // Guardar detalles en el log
    await this.logToFile(`\n=== ANÁLISIS DE RESPUESTA: ${testName.toUpperCase()} ===`);

    // Verificar hallazgos de alucinación
    const responseText = assistantMessage.text;
    await this.logToFile(`RESPUESTA: ${responseText}`);

    // Analizar acciones ejecutadas
    await this.logToFile(`ACCIONES EJECUTADAS (${actions.length}):`);
    for (const action of actions) {
      await this.logToFile(`- ${action.name}`);

      if (action.result && action.result.success) {
        // Verificar qué datos reales fueron utilizados
        if (action.name === 'fetch_token_data' || action.name === 'fetch_wallet_data') {
          await this.checkDataAccuracy(action, responseText);
        }
      } else if (action.result) {
        await this.logToFile(`  ❌ FALLO: ${action.result.error || 'Error desconocido'}`);
      }
    }

    // Evaluar si la respuesta parece contener alucinaciones
    await this.evaluateHallucinations(responseText, actions);
  }

  // Verifica la precisión de los datos utilizados
  async checkDataAccuracy(action, responseText) {
    await this.logToFile(`  ✓ DATOS RECUPERADOS:`);

    if (action.name === 'fetch_token_data' && action.result.data.token) {
      const token = action.result.data.token;
      await this.logToFile(`    Token: ${token.name} (${token.symbol})`);
      await this.logToFile(`    Precio: $${token.price}`);

      // Verificar si el precio mencionado en la respuesta coincide con los datos
      const priceInText = this.extractPrice(responseText);
      if (priceInText) {
        const priceDifference = Math.abs(priceInText - token.price);
        const isAccurate = priceDifference < 1; // Permitir pequeña diferencia por redondeo

        await this.logToFile(`    Precio mencionado: $${priceInText}`);
        await this.logToFile(`    Precisión: ${isAccurate ? '✓ CORRECTA' : '❌ INCORRECTA'}`);
      }
    }

    if (action.name === 'fetch_wallet_data' && action.result.data.tokens) {
      const tokens = action.result.data.tokens;
      await this.logToFile(`    Wallet: ${action.result.data.wallet}`);
      await this.logToFile(`    Valor total: $${tokens.totalTokenValueUsd}`);
      await this.logToFile(`    Tokens: ${tokens.totalTokenCount}`);

      // Verificar si el número de tokens mencionados coincide
      const tokensInText = this.extractTokenCount(responseText);
      if (tokensInText) {
        const isAccurate = tokensInText === tokens.totalTokenCount;
        await this.logToFile(`    Tokens mencionados: ${tokensInText}`);
        await this.logToFile(`    Precisión: ${isAccurate ? '✓ CORRECTA' : '❌ INCORRECTA'}`);
      }
    }
  }

  // Evalúa posibles alucinaciones en la respuesta
  async evaluateHallucinations(responseText, actions) {
    await this.logToFile(`\nEVALUACIÓN DE ALUCINACIONES:`);

    // Banderas de alucinación
    let hallucinationFlags = [];

    // 1. Verifica cifras precisas sin fuente de datos
    const hasPreciseNumbers = /\$\d+\.\d{2,}/.test(responseText) ||
                              /\d{1,3}(?:,\d{3})+\.\d{2,}/.test(responseText);

    const hasDataSource = actions.some(a =>
      a.name === 'fetch_token_data' ||
      a.name === 'fetch_wallet_data' ||
      a.name === 'semantic_query'
    );

    if (hasPreciseNumbers && !hasDataSource) {
      hallucinationFlags.push('Cifras precisas sin fuente de datos');
    }

    // 2. Verifica afirmaciones categóricas sobre precios futuros
    const hasPricePredictions = /will increase|will decrease|garantizar|garantizado|guaranteed|sure to|definitely|sin duda aumentará|sin duda bajará/.test(responseText.toLowerCase());

    if (hasPricePredictions) {
      hallucinationFlags.push('Predicciones definitivas sobre precios futuros');
    }

    // 3. Verifica si reconoce limitaciones cuando corresponde
    const hasUnsupportedClaims = actions.some(a => !a.result.success);
    const acknowledgesLimitations = /no tengo acceso|no puedo acceder|no cuento con|no dispongo|i don't have access|cannot access|unable to|no puedo/.test(responseText.toLowerCase());

    if (hasUnsupportedClaims && !acknowledgesLimitations) {
      hallucinationFlags.push('No reconoce limitaciones cuando hay datos inaccesibles');
    }

    // Reporte de hallazgos
    if (hallucinationFlags.length > 0) {
      await this.logToFile(`❌ POSIBLES ALUCINACIONES DETECTADAS:`);
      for (const flag of hallucinationFlags) {
        await this.logToFile(`  - ${flag}`);
      }
    } else {
      await this.logToFile(`✅ No se detectaron indicios de alucinación`);
    }

    await this.logToFile(`\n`);
  }

  // Extrae precio mencionado en el texto
  extractPrice(text) {
    const priceMatch = text.match(/\$(\d+(\.\d+)?)/);
    return priceMatch ? parseFloat(priceMatch[1]) : null;
  }

  // Extrae número de tokens mencionados en el texto
  extractTokenCount(text) {
    // Patrones comunes para mencionar cantidad de tokens
    const patterns = [
      /(\d+)\s+tokens/i,
      /(\d+)\s+diferentes tipos de token/i,
      /(\d+)\s+tipos de token/i,
      /(\d+)\s+criptomonedas/i
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return parseInt(match[1]);
      }
    }

    return null;
  }
}

// Ejecutar si se llama directamente
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(chalk.bgCyan.black.bold('\n📊 TEST DE VALIDACIÓN DE RESPUESTAS DE IA 📊\n'));

  const tester = new EnhancedConversationTest();
  tester.runTests().catch(error => {
    console.error('Error no manejado:', error);
    process.exit(1);
  });
}

export default EnhancedConversationTest;
