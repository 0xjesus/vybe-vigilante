import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import ConversationService from './services/conversation.service.js';

// Asegurar que el directorio de logs existe
const logDir = process.env.LOG_DIR || 'logs';
const logPath = path.resolve(process.cwd(), logDir);

if(!fs.existsSync(logPath)) {
	fs.mkdirSync(logPath, { recursive: true });
	console.log(`Created log directory: ${ logPath }`);
}

const TEST_USER_ID = 1;
const serviceInstance = new ConversationService();

// Función helper para ejecutar y registrar pruebas
async function runTest(name, message) {
	console.log(`\n======== EXECUTING TEST: ${ name } ========`);
	try {
		const result = await serviceInstance.sendMessage(TEST_USER_ID, null, message, null);
		console.log(`✅ ${ name }: Success`);
		return result;
	} catch(error) {
		console.error(`❌ ${ name }: Failed - ${ error.message }`);
		return { error: error.message };
	}
}

const tests = [
  {
    name: "fetch_top_tokens",
    message: "¿Cuáles son los tokens con mayor marketcap en Solana actualmente?"
  },
  {
    name: "analyze_token_trend",
    message: "Analiza la tendencia de JUP en la última semana considerando precio, volumen y número de holders."
  },
];
// Array de pruebas para todas las acciones
/*const tests = [
  // Acciones de información del usuario
  {
    name: "remember_info",
    message: "Por favor recuerda que mi nombre es Carlos y estoy interesado en invertir en tokens de gaming en Solana."
  },
  {
    name: "create_strategy",
    message: "Crea una estrategia de inversión llamada 'Gaming Tokens' que incluya los mejores tokens de gaming en Solana con un horizonte de inversión a medio plazo."
  },

  // Acciones de tokens
  {
    name: "fetch_token_data",
    message: "Dame todos los detalles sobre el token JUP incluyendo sus principales holders."
  },
  {
    name: "fetch_token_price_history",
    message: "Muéstrame el historial de precios de SOL en los últimos 30 días con resolución diaria."
  },
  {
    name: "fetch_token_holders_data",
    message: "¿Quiénes son los 10 mayores holders de BONK?"
  },
  {
    name: "fetch_token_transfers",
    message: "Necesito ver las transferencias más recientes de JTO por un valor superior a $10,000."
  },
  {
    name: "fetch_top_tokens",
    message: "¿Cuáles son los tokens con mayor marketcap en Solana actualmente?"
  },
  {
    name: "analyze_token_trend",
    message: "Analiza la tendencia de JUP en la última semana considerando precio, volumen y número de holders."
  },
  {
    name: "recommend_tokens",
    message: "Recomiéndame tokens de bajo riesgo para invertir a largo plazo."
  },

  // Acciones de wallet
  {
    name: "fetch_wallet_data",
    message: "Analiza esta wallet: HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH. Quiero ver sus tokens y NFTs."
  },
  {
    name: "fetch_wallet_pnl",
    message: "¿Cuál ha sido el rendimiento (PnL) de la wallet HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH en los últimos 30 días?"
  },
  {
    name: "get_wallet_tokens_time_series",
    message: "Muéstrame la evolución de los balances de tokens de la wallet HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH en los últimos 30 días."
  },

  // Acciones de programas
  {
    name: "fetch_program_details",
    message: "Dame los detalles del programa JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN (Jupiter)."
  },
  {
    name: "fetch_program_active_users",
    message: "¿Cuántos usuarios activos tiene el programa JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN en los últimos 7 días?"
  },
  {
    name: "fetch_program_tvl",
    message: "¿Cuál es el TVL (Total Value Locked) actual del programa KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD (Kamino Lend)?"
  },
  {
    name: "fetch_program_ranking",
    message: "¿Cuáles son los 10 programas más utilizados en Solana actualmente?"
  },

  // Acciones de mercado
  {
    name: "fetch_market_info",
    message: "Dame información sobre el mercado SOL/USDC en Raydium."
  },
  {
    name: "fetch_pair_ohlcv",
    message: "Necesito datos OHLCV del par de trading SOL/USDC en los últimos 7 días con resolución horaria."
  },

  // Acciones de alertas
  {
    name: "create_price_alert",
    message: "Crea una alerta para avisarme cuando el precio de SOL supere los $150."
  },
  {
    name: "schedule_alert",
    message: "Programa una alerta para verificar el TVL de Kamino en 24 horas."
  },

  // Acciones de búsqueda semántica
  {
    name: "semantic_query",
    message: "Busca información sobre '¿Qué es el staking en Solana?' en nuestras conversaciones anteriores."
  },
  {
    name: "evaluate_query_intent",
    message: "¿Recuerdas cuándo hablamos sobre los mejores tokens de gaming?"
  },

  // Acciones especializadas
  {
    name: "get_known_accounts",
    message: "Dame una lista de cuentas conocidas en Solana que estén relacionadas con CEX (centralized exchanges)."
  },
  {
    name: "get_token_transfers_analysis",
    message: "Analiza las transferencias de BONK en las últimas 24 horas y dime si hay patrones de whale activity."
  },
  {
    name: "get_price_prediction",
    message: "Haz una predicción de precio para SOL en los próximos 7 días con un nivel de confianza medio."
  },
  {
    name: "compare_tokens",
    message: "Compara JUP, BONK y JTO en términos de precio, volumen, holders y volatilidad durante la última semana."
  }
];*/

// Ejecutar todas las pruebas secuencialmente
async function runAllTests() {
	console.log(`Starting test suite with ${ tests.length } tests...`);

	const results = {};
	for(const test of tests) {
		results[test.name] = await runTest(test.name, test.message);
	}

	// Resumen final
	console.log('\n======== TEST SUMMARY ========');
	const successful = Object.values(results).filter(r => !r.error).length;
	console.log(`Total tests: ${ tests.length }`);
	console.log(`Successful: ${ successful }`);
	console.log(`Failed: ${ tests.length - successful }`);

}

// Ejecutar todas las pruebas
await runAllTests();
