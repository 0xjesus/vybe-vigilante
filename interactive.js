// interactive_chat.js
import 'dotenv/config'; // Carga variables de entorno (.env)
import readline from 'readline'; // Módulo para interactuar con la terminal
import ConversationService from './services/conversation.service.js'; // Asegúrate que la ruta es correcta

// --- Configuración ---
const TEST_USER_ID = 1; // ID del usuario para la conversación
// --- Fin Configuración ---

console.log('🚀 Iniciando Chat Interactivo...');
console.warn('🚨 Usando servicios REALES (IA, DB, Vybe, Chroma). Asegura tu .env.');
console.log('Escribe "exit" o "quit" para terminar.');

let serviceInstance;
try {
    serviceInstance = new ConversationService();
    console.log('✅ ConversationService listo.');
} catch (error) {
    console.error('❌ Error fatal al iniciar ConversationService:', error);
    console.error('👉 Verifica la conexión a la base de datos y la configuración inicial.');
    process.exit(1); // Salir si no se puede iniciar el servicio
}

// Crear interfaz para leer de la terminal (stdin) y escribir en ella (stdout)
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'Tú: ', // El texto que aparecerá antes de que escribas
});

let currentChatId = null; // Mantiene el ID del chat actual entre mensajes

// Función principal que maneja el ciclo de pregunta-respuesta
const askQuestion = () => {
    rl.prompt(); // Muestra el prompt "Tú: "

    rl.once('line', async (line) => { // Escucha una sola vez la siguiente línea que escribas
        const userInput = line.trim();

        // --- Condición de Salida ---
        if (userInput.toLowerCase() === 'exit' || userInput.toLowerCase() === 'quit') {
            rl.close(); // Cierra la interfaz de readline
            return; // Termina la función
        }

        // --- Llamada al ConversationService ---
        console.log('🔄 Procesando tu mensaje...');
        try {
            const result = await serviceInstance.sendMessage(
                TEST_USER_ID,
                currentChatId, // Usa el ID del chat actual (null al principio)
                userInput,
                null // Session ID (no aplica para este script de consola)
            );

            // Actualizar el ID del chat para la siguiente interacción
            if (result?.chat?.id) {
                currentChatId = result.chat.id;
            }

            // --- Mostrar Respuesta del Asistente ---
            const assistantReply = result?.assistantMessage?.text ?? 'No se recibió respuesta del asistente.';
            console.log(`\n🤖 Asistente (Chat ${currentChatId}):`);
            console.log(assistantReply);

            // Mostrar info adicional si hubo acciones o datos estructurados
            if (result?.executedActions?.length > 0) {
                console.log(`   ✨ (Acciones ejecutadas: ${result.executedActions.map(a => a.name).join(', ')})`);
            }
            if (result?.structuredData) {
                console.log(`   📊 (Datos estructurados recibidos)`);
                // Opcional: mostrar los datos estructurados
                // console.log(JSON.stringify(result.structuredData, null, 2));
            }
            console.log('---'); // Separador visual

        } catch (error) {
            console.error('\n❌ Error al enviar o procesar el mensaje:', error.message);
            // Opcional: Loguear el stack trace completo para debugging
            // console.error(error.stack);
            console.log('---');
        }

        // Volver a preguntar (continuar el ciclo)
        askQuestion();
    });
};

// Evento que se dispara cuando cierras la interfaz (con 'exit' o Ctrl+C)
rl.on('close', () => {
    console.log('\n👋 ¡Adiós! Terminando chat.');
    // Opcional: Desconectar Prisma si es necesario
    serviceInstance.prisma.$disconnect()
        .then(() => console.log('🔌 Prisma desconectado.'))
        .catch(e => console.warn('⚠️ Error al desconectar Prisma:', e.message))
        .finally(() => process.exit(0)); // Salir del proceso de Node.js
});

// --- Iniciar la conversación ---
console.log(`\nIniciando conversación para User ID: ${TEST_USER_ID}`);
askQuestion(); // Llama a la función por primera vez para empezar el ciclo
