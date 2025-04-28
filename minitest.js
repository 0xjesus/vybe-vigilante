import 'dotenv/config';
import ConversationService from './services/conversation.service.js';



const TEST_USER_ID = 1;

const serviceInstance = new ConversationService();

const result1 = await serviceInstance.sendMessage(
	TEST_USER_ID,
	null,
	"hola, en que me recomiendas invertir?",
	null
)

console.log('Result 1:', result1);
