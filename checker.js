// test-instance-semantic-query.js

import 'dotenv/config'; // Carga variables de entorno desde .env
// Importa la CLASE correcta
import ConversationService from './services/conversation.service.js'; // <-- IMPORTANTE: Ajusta la ruta

// --- Logger Simulado (Mock Logger) ---
// Necesitamos este logger para pasarlo a la instancia de ConversationService
class ConsoleLogger {
	constructor(context = 'TestContext') {
		this.context = context;
	}

	_log(level, message, data) {
		const timestamp = new Date().toISOString();
		// Get current date and time in Mexico City timezone
		const userTime = new Date().toLocaleString('en-US', { timeZone: 'America/Mexico_City' });
		// Construct log message with both timestamps
		let logMsg = `[${ timestamp } UTC] [${ userTime } Puebla] [${ level }] [${ this.context }] ${ message }`;
		//let logMsg = `[${timestamp}] [${level}] [${this.context}] ${message}`;
		if(data !== undefined) {
			if(data instanceof Error) {
				logMsg += `\n${ data.stack }`;
			} else {
				try {
					logMsg += `\n${ JSON.stringify(data, null, 2) }`;
				} catch(e) {
					logMsg += `\n[Cannot stringify data]`;
				}
			}
		}
		console.log(logMsg);
	}

	entry(functionName, args) { this._log('ENTRY', `Entering ${ functionName }`, args); }

	exit(functionName, result) { this._log('EXIT', `Exiting ${ functionName }`, result); }

	info(message, data) { this._log('INFO', message, data); }

	debug(message, data) { this._log('DEBUG', message, data); }

	warn(message, data) { this._log('WARN', message, data); }

	error(message, error) { this._log('ERROR', message, error); }

	success(message, data) { this._log('SUCCESS', message, data); }
}

// --- Fin Logger Simulado ---

/**
 * Función principal para ejecutar la prueba del método de instancia
 */
async function testInstanceSemanticQuery() {
	const logger = new ConsoleLogger('InstanceQueryTest'); // Logger para pasar a la instancia
	logger.info('--- [TEST] Iniciando prueba de ConversationService#actionSemanticQuery (instance) ---');

	// --- Configuración de la Prueba ---
	const testQueryText = 'me interesa crash amigo?'; // <-- Cambia tu consulta aquí
	const resultLimit = 5; // Cuántos resultados quieres
	// -----------------------------------

	// --- Instancia de ConversationService ---
	// Pasamos el logger simulado. Si el constructor necesita más cosas, añádelas.
	let conversationServiceInstance;
	try {
		logger.info('Creando instancia de ConversationService...');
		conversationServiceInstance = new ConversationService(logger); // Ajusta si necesita más args
		logger.info('Instancia de ConversationService creada.');
	} catch(error) {
		logger.error('Error al crear la instancia de ConversationService', error);
		logger.info('--- [TEST] Prueba abortada ---');
		return; // Salir si no se puede crear la instancia
	}
	// --------------------------------------

	// Argumentos para la función
	const queryArgs = {
		query: testQueryText,
		limit: resultLimit.toString(),
	};

	try {
		logger.info(`\n--- [TEST] Llamando a instance.actionSemanticQuery con: ---\n${ JSON.stringify(queryArgs, null, 2) }\n`);

		// --- Llamada al Método de Instancia ---
		const results = await conversationServiceInstance.actionSemanticQuery(queryArgs);
		// --- Fin Llamada ---

		logger.success('\n--- [TEST] ¡actionSemanticQuery (instance) se ejecutó exitosamente! ---');
		logger.info('--- [TEST] Resultados recibidos: ---');
		// Imprime los resultados de forma legible
		console.log(JSON.stringify(results, null, 2)); // Usamos console.log directo para el JSON
		logger.info('\n');

	} catch(error) {
		logger.error('\n--- [TEST] ¡Error durante la ejecución de actionSemanticQuery (instance)! ---');
		logger.error(`[TEST] Mensaje: ${ error.message }`, error);
		logger.info('\n');
	} finally {
		logger.info('--- [TEST] Prueba de ConversationService#actionSemanticQuery finalizada ---');
	}
}

// Ejecutar la prueba
testInstanceSemanticQuery()
	.catch(err => {
		// Captura errores no manejados en la función principal de prueba
		console.error('--- [TEST] Error fatal no capturado en testInstanceSemanticQuery ---');
		console.error(err);
		process.exit(1); // Termina con error
	});
