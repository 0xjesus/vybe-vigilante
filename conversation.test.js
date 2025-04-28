import 'dotenv/config';
import ConversationService from './services/conversation.service.js';
import ChromaService from './services/chroma.service.js';
import chalk from 'chalk';

// Test constants
const TEST_USER_ID = 1; // Set to a valid user ID in your database
const TEST_WALLET_ADDRESS = 'HFJEhqTUPKKWvhwVeQS5qjSP373kMUFpNuiqMMyXZ2Gr'; // Example wallet from your tests
const TEST_TOKEN_ADDRESS = 'So11111111111111111111111111111111111111112'; // wSOL

/**
 * Testing utility for ConversationService - with real service calls
 */
class ConversationServiceTest {
  constructor() {
    console.log(chalk.cyan('🔧 Initializing ConversationServiceTest...'));
    this.service = new ConversationService();
    this.chatId = null; // Will store the created chat ID for sequential tests
    console.log(chalk.green('✅ ConversationServiceTest initialized'));
    console.log(chalk.gray(`💡 This test will use USER_ID=${TEST_USER_ID}`));
    console.log(chalk.gray(`💡 Test wallet: ${TEST_WALLET_ADDRESS}`));
    console.log(chalk.gray(`💡 Test token: ${TEST_TOKEN_ADDRESS} (wSOL)`));
  }

  /**
   * Helper to log test sections
   * @param {string} title
   */
  logTitle(title) {
    console.log(chalk.cyan.bold.underline(`\n🧪 ${title} 🧪`));
  }

  /**
   * Helper to log test steps
   * @param {string} step
   */
  logStep(step) {
    console.log(chalk.yellow(`  ► ${step}`));
  }

  /**
   * Helper to log success
   * @param {string} message
   * @param {Object} data
   */
  logSuccess(message, data = null) {
    console.log(chalk.green(`  ✅ ${message}`));
    if (data) {
      const output = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
      console.log(chalk.gray(`     ${output.substring(0, 500)}${output.length > 500 ? '...' : ''}`));
    }
  }

  /**
   * Helper to log error
   * @param {string} message
   * @param {Error} error
   */
  logError(message, error) {
    console.log(chalk.red(`  ❌ ${message}`));
    console.error(chalk.redBright(`     ${error.message}`));
    console.error(error.stack);
  }

  /**
   * Helper to inspect a response object
   * @param {Object} result - Result from conversation service
   */
  logResponseDetails(result) {
    console.log(chalk.yellow('\n  📋 Detailed response analysis:'));

    // Chat details
    console.log(chalk.yellow('  ▶ Chat details:'));
    console.log(chalk.gray(`     ID: ${result.chat.id}`));
    console.log(chalk.gray(`     Title: ${result.chat.title}`));
    console.log(chalk.gray(`     Platform: ${result.chat.platform}`));
    console.log(chalk.gray(`     Message count: ${result.chat.messageCount}`));

    // User message
    console.log(chalk.yellow('  ▶ User message:'));
    console.log(chalk.gray(`     ID: ${result.userMessage.id}`));
    console.log(chalk.gray(`     Tokens: ${result.userMessage.tokens}`));
    console.log(chalk.gray(`     Text preview: ${result.userMessage.text.substring(0, 100)}${result.userMessage.text.length > 100 ? '...' : ''}`));

    // Assistant message
    console.log(chalk.yellow('  ▶ Assistant message:'));
    console.log(chalk.gray(`     ID: ${result.assistantMessage.id}`));
    console.log(chalk.gray(`     Tokens: ${result.assistantMessage.tokens}`));
    console.log(chalk.gray(`     Text preview: ${result.assistantMessage.text.substring(0, 100)}${result.assistantMessage.text.length > 100 ? '...' : ''}`));

    // Actions executed
    const actionsCount = result.actions ? result.actions.length : 0;
    console.log(chalk.yellow(`  ▶ Actions executed (${actionsCount}):`));

    if (actionsCount > 0) {
      result.actions.forEach((action, index) => {
        console.log(chalk.gray(`     ${index + 1}. ${action.name}`));

        // Log success or failure
        if (action.result && action.result.success) {
          console.log(chalk.green(`        ✓ Success`));

          // Log action-specific details
          if (action.name === 'remember_info' && action.result.data) {
            console.log(chalk.gray(`        Stored: ${action.result.data.key} = ${action.result.data.value}`));
          } else if (action.name === 'create_strategy' && action.result.data) {
            console.log(chalk.gray(`        Created strategy: ${action.result.data.strategy.name}`));
          } else if ((action.name === 'fetch_token_data' || action.name === 'fetch_wallet_data') && action.result.data) {
            console.log(chalk.gray(`        Data size: ${JSON.stringify(action.result.data).length} bytes`));

            // Check if Chroma was used
            if (action.result.data.chroma_data) {
              console.log(chalk.cyan(`        ℹ️ Large data embedded in Chroma: ${action.result.data.chroma_data.collection_name}`));
            }
          } else if (action.name === 'evaluate_query_intent' && action.result.data) {
            console.log(chalk.gray(`        Needs semantic search: ${action.result.data.needs_semantic_search}`));
            console.log(chalk.gray(`        Optimized query: "${action.result.data.optimized_query}"`));
            if (action.result.data.recommended_collection) {
              console.log(chalk.gray(`        Recommended collection: ${action.result.data.recommended_collection}`));
            }
          } else if (action.name === 'semantic_query' && action.result.data) {
            console.log(chalk.gray(`        Query: "${action.result.data.query}"`));
            console.log(chalk.gray(`        Found ${action.result.data.results?.length || 0} results`));
          } else if (action.name === 'schedule_alert' && action.result.data) {
            console.log(chalk.gray(`        Scheduled alert: ${action.result.data.type}, Task ID: ${action.result.data.taskId}`));
          }
        } else {
          console.log(chalk.red(`        ✗ Failed: ${action.result ? action.result.error : 'Unknown error'}`));
        }
      });
    } else {
      console.log(chalk.gray('     No actions executed'));
    }
  }

  /**
   * Verify ChromaDB connection is working
   */
  async testChromaConnection() {
    this.logTitle('ChromaDB Connection Test');

    try {
      this.logStep('Checking ChromaDB server health...');
      const isHealthy = await ChromaService.checkServerHealth();

      if (isHealthy) {
        this.logSuccess('ChromaDB connection is working properly');

        // List collections
        this.logStep('Listing available collections...');
        const collections = await ChromaService.listCollections();
        this.logSuccess(`Found ${collections.length} collections:`, collections);

        return true;
      } else {
        this.logError('ChromaDB connection failed', new Error('Server health check failed'));
        return false;
      }
    } catch (error) {
      this.logError('ChromaDB connection test failed', error);
      return false;
    }
  }

  /**
   * Test basic conversation flow
   */
  async testBasicConversation() {
    this.logTitle('Basic conversation flow');

    try {
      this.logStep('Starting new conversation');
      console.time('Basic conversation test');

      const result = await this.service.sendMessage(
        TEST_USER_ID,
        null, // chatId (new conversation)
        'Hello, I need help understanding Solana blockchain and tokens.',
        null, // sessionId
      );

      console.timeEnd('Basic conversation test');
      this.logSuccess('Conversation started successfully', result);
      this.logResponseDetails(result);

      // Save chatId for subsequent tests
      this.chatId = result.chat.id;
      this.logStep(`Chat ID ${this.chatId} saved for subsequent tests`);

      return result;
    } catch (error) {
      this.logError('Basic conversation test failed', error);
      throw error;
    }
  }

  /**
   * Test follow-up conversation
   */
  async testFollowUpConversation() {
    this.logTitle('Follow-up conversation');

    if (!this.chatId) {
      this.logError('Follow-up test skipped', new Error('No chat ID available. Run basic test first.'));
      return null;
    }

    try {
      this.logStep(`Continuing conversation in chat ID ${this.chatId}`);
      console.time('Follow-up conversation test');

      const result = await this.service.sendMessage(
        TEST_USER_ID,
        this.chatId,
        'What is the difference between SOL and SPL tokens?',
        null, // sessionId
      );

      console.timeEnd('Follow-up conversation test');
      this.logSuccess('Follow-up conversation successful', result);
      this.logResponseDetails(result);

      return result;
    } catch (error) {
      this.logError('Follow-up conversation test failed', error);
      throw error;
    }
  }

  /**
   * Test requesting token information
   */
  async testTokenInformation() {
    this.logTitle('Requesting token information');

    if (!this.chatId) {
      this.logError('Token information test skipped', new Error('No chat ID available. Run basic test first.'));
      return null;
    }

    try {
      this.logStep(`Asking about wSOL token information in chat ID ${this.chatId}`);
      console.time('Token information test');

      const result = await this.service.sendMessage(
        TEST_USER_ID,
        this.chatId,
        `Can you tell me about the wrapped SOL token at address ${TEST_TOKEN_ADDRESS}?`,
        null, // sessionId
      );

      console.timeEnd('Token information test');
      this.logSuccess('Token information request successful', result);
      this.logResponseDetails(result);

      // Check if Chroma was used for embedding large data
      if (result.actions && result.actions.length > 0) {
        const tokenAction = result.actions.find(a => a.name === 'fetch_token_data');
        if (tokenAction && tokenAction.result && tokenAction.result.data && tokenAction.result.data.chroma_data) {
          this.logSuccess(
            '✨ Chroma was used to embed large token data',
            tokenAction.result.data.chroma_data
          );
        }
      }

      return result;
    } catch (error) {
      this.logError('Token information test failed', error);
      throw error;
    }
  }

  /**
   * Test requesting wallet information
   */
  async testWalletInformation() {
    this.logTitle('Requesting wallet information');

    if (!this.chatId) {
      this.logError('Wallet information test skipped', new Error('No chat ID available. Run basic test first.'));
      return null;
    }

    try {
      this.logStep(`Asking about wallet information in chat ID ${this.chatId}`);
      console.time('Wallet information test');

      const result = await this.service.sendMessage(
        TEST_USER_ID,
        this.chatId,
        `What tokens are held in this wallet: ${TEST_WALLET_ADDRESS}?`,
        null, // sessionId
      );

      console.timeEnd('Wallet information test');
      this.logSuccess('Wallet information request successful', result);
      this.logResponseDetails(result);

      // Check if Chroma was used for embedding large data
      if (result.actions && result.actions.length > 0) {
        const walletAction = result.actions.find(a => a.name === 'fetch_wallet_data');
        if (walletAction && walletAction.result && walletAction.result.data && walletAction.result.data.chroma_data) {
          this.logSuccess(
            '✨ Chroma was used to embed large wallet data',
            walletAction.result.data.chroma_data
          );
        }
      }

      return result;
    } catch (error) {
      this.logError('Wallet information test failed', error);
      throw error;
    }
  }

  /**
   * Test saving user preference
   */
  async testSavingPreference() {
    this.logTitle('Saving user preference');

    if (!this.chatId) {
      this.logError('Save preference test skipped', new Error('No chat ID available. Run basic test first.'));
      return null;
    }

    try {
      this.logStep(`Telling AI about a preference in chat ID ${this.chatId}`);
      console.time('Saving preference test');

      const result = await this.service.sendMessage(
        TEST_USER_ID,
        this.chatId,
        'I\'m interested in DeFi tokens and I\'m a long-term investor who prefers low-risk strategies.',
        null, // sessionId
      );

      console.timeEnd('Saving preference test');
      this.logSuccess('Preference sharing successful', result);
      this.logResponseDetails(result);

      // Check if we have memory items saved
      this.logStep('Checking if memory items were created');
      console.time('Memory check');
      const conversation = await this.service.getConversation(this.chatId, TEST_USER_ID);
      console.timeEnd('Memory check');

      if (conversation.memory &&
        conversation.memory.items &&
        Object.keys(conversation.memory.items).length > 0) {
        this.logSuccess('Memory items found', conversation.memory.items);

        // Log each memory item in detail
        console.log(chalk.yellow('\n  📋 Memory items detailed:'));
        Object.entries(conversation.memory.items).forEach(([key, value]) => {
          console.log(chalk.gray(`     🧠 ${key}: ${value} (${typeof value})`));
        });
      } else {
        this.logStep('No memory items created yet. This is expected if the AI did not detect clear preferences to store.');
      }

      return result;
    } catch (error) {
      this.logError('Saving preference test failed', error);
      throw error;
    }
  }

  /**
   * Test creating an investment strategy
   */
  async testCreatingStrategy() {
    this.logTitle('Creating investment strategy');

    if (!this.chatId) {
      this.logError('Strategy creation test skipped', new Error('No chat ID available. Run basic test first.'));
      return null;
    }

    try {
      this.logStep(`Requesting strategy creation in chat ID ${this.chatId}`);
      console.time('Strategy creation test');

      const result = await this.service.sendMessage(
        TEST_USER_ID,
        this.chatId,
        'Can you create a DeFi investment strategy for me that focuses on SOL and other major Solana tokens?',
        null, // sessionId
      );

      console.timeEnd('Strategy creation test');
      this.logSuccess('Strategy creation request successful', result);
      this.logResponseDetails(result);

      // Check if we have a strategy object created
      this.logStep('Checking if strategy was created');
      console.time('Strategy check');
      const conversation = await this.service.getConversation(this.chatId, TEST_USER_ID);
      console.timeEnd('Strategy check');

      if (conversation.memory &&
        conversation.memory.objects &&
        conversation.memory.objects.some(obj => obj.objectType === 'strategy')) {

        const strategies = conversation.memory.objects.filter(obj => obj.objectType === 'strategy');
        this.logSuccess('Strategy objects found', strategies);

        // Log each strategy in detail
        console.log(chalk.yellow('\n  📋 Strategies detailed:'));
        strategies.forEach((strategy, index) => {
          console.log(chalk.gray(`     📊 Strategy ${index + 1}: ${strategy.name}`));
          console.log(chalk.gray(`        ID: ${strategy.id}`));
          console.log(chalk.gray(`        Created: ${strategy.created}`));
          console.log(chalk.gray(`        Data: ${JSON.stringify(strategy.data).substring(0, 200)}...`));
        });
      } else {
        this.logStep('No strategy objects created yet. This depends on how the AI interpreted the request.');
      }

      return result;
    } catch (error) {
      this.logError('Strategy creation test failed', error);
      throw error;
    }
  }

  /**
   * Test listing conversations
   */
  async testListConversations() {
    this.logTitle('Listing user conversations');

    try {
      this.logStep(`Getting conversations for user ID ${TEST_USER_ID}`);
      console.time('List conversations test');

      const conversations = await this.service.getUserConversations(TEST_USER_ID);
      console.timeEnd('List conversations test');

      this.logSuccess(`Found ${conversations.length} conversations`, conversations);

      // Log each conversation in detail
      console.log(chalk.yellow('\n  📋 Conversations detailed:'));
      conversations.forEach((chat, index) => {
        console.log(chalk.gray(`     💬 Chat ${index + 1}: "${chat.title}"`));
        console.log(chalk.gray(`        ID: ${chat.id}`));
        console.log(chalk.gray(`        Platform: ${chat.platform}`));
        console.log(chalk.gray(`        Created: ${chat.created}`));
        console.log(chalk.gray(`        Last active: ${chat.lastMessageAt}`));
        console.log(chalk.gray(`        Messages: ${chat._count?.messages || 'Unknown'}`));
      });

      return conversations;
    } catch (error) {
      this.logError('List conversations test failed', error);
      throw error;
    }
  }

  /**
   * Test semantic query capabilities
   */
  async testSemanticQuery() {
    this.logTitle('Testing semantic query capabilities');

    if (!this.chatId) {
      this.logError('Semantic query test skipped', new Error('No chat ID available. Run basic test first.'));
      return null;
    }

    try {
      // First, create a collection from the chat
      this.logStep('Creating search collection from chat');
      console.time('Create collection');
      const collection = await this.service.createSearchCollection(this.chatId);
      console.timeEnd('Create collection');
      this.logSuccess('Search collection created', collection);

      // Now test a semantic query using the evaluate_query_intent pattern
      this.logStep('Performing semantic query with query evaluation');
      console.time('Semantic query test');
      const result = await this.service.sendMessage(
        TEST_USER_ID,
        this.chatId,
        'Can you search our conversation for information about investment strategies?',
        null, // sessionId
      );
      console.timeEnd('Semantic query test');

      this.logSuccess('Semantic query request successful', result);
      this.logResponseDetails(result);

      // Check for query evaluation and semantic query results
      if (result.actions && result.actions.length > 0) {
        const evaluateAction = result.actions.find(a => a.name === 'evaluate_query_intent');
        const queryAction = result.actions.find(a => a.name === 'semantic_query');

        if (evaluateAction && evaluateAction.result && evaluateAction.result.data) {
          this.logSuccess('✨ Query evaluation executed successfully');

          // Log evaluation results in detail
          console.log(chalk.yellow('\n  📋 Query evaluation results:'));
          console.log(chalk.gray(`     🔍 Original query: "Can you search our conversation for information about investment strategies?"`));
          console.log(chalk.gray(`     Needs semantic search: ${evaluateAction.result.data.needs_semantic_search}`));
          console.log(chalk.gray(`     Optimized query: "${evaluateAction.result.data.optimized_query}"`));

          if (evaluateAction.result.data.recommended_collection) {
            console.log(chalk.gray(`     Recommended collection: ${evaluateAction.result.data.recommended_collection}`));
          }

          console.log(chalk.gray(`     Reasoning: ${evaluateAction.result.data.reasoning}`));
        }

        if (queryAction && queryAction.result && queryAction.result.data) {
          this.logSuccess('✨ Semantic query executed successfully');

          // Log query results in detail
          console.log(chalk.yellow('\n  📋 Semantic query results:'));
          console.log(chalk.gray(`     🔍 Query: "${queryAction.result.data.query}"`));

          if (queryAction.result.data.results && queryAction.result.data.results.length > 0) {
            console.log(chalk.gray(`     Found ${queryAction.result.data.results.length} results:`));

            queryAction.result.data.results.forEach((item, index) => {
              console.log(chalk.gray(`     Result ${index + 1}:`));
              console.log(chalk.gray(`       Distance: ${item.distance}`));
              console.log(chalk.gray(`       Metadata: ${JSON.stringify(item.metadata)}`));
              console.log(chalk.gray(`       Document preview: ${typeof item.document === 'string' 
                ? item.document.substring(0, 100) + '...' 
                : 'Non-string document'}`));
            });
          } else {
            console.log(chalk.gray(`     No results found`));
          }
        }
      }

      return result;
    } catch (error) {
      this.logError('Semantic query test failed', error);
      // Don't throw - this test is optional depending on ChromaDB setup
      return null;
    }
  }

  /**
   * Run all tests in sequence
   */
  async runAllTests() {
    console.log(chalk.bgCyan.black.bold('\n🚀 STARTING ConversationService TESTS 🚀\n'));

    try {
      // Verify environment is set up
      this.logTitle('Environment check');
      this.logStep('Checking for required environment variables');

      if (!process.env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY environment variable is not set');
      }

      if (!process.env.VYBE_API_KEY) {
        throw new Error('VYBE_API_KEY environment variable is not set');
      }

      // Check for ChromaDB configuration
      if (!process.env.CHROMA_SERVER_URL) {
        console.log(chalk.yellow('⚠️ CHROMA_SERVER_URL environment variable is not set - semantic search features will be limited'));
      } else {
        console.log(chalk.gray(`💡 ChromaDB URL: ${process.env.CHROMA_SERVER_URL}`));
      }

      this.logSuccess('Environment variables present');

      // Test ChromaDB connection if URL is provided
      if (process.env.CHROMA_SERVER_URL) {
        await this.testChromaConnection();
      }

      // Run tests in sequence (order matters as they build on each other)
      console.log(chalk.magenta.bold('\n📋 TEST EXECUTION PLAN:'));
      console.log(chalk.magenta('1. Basic conversation - Initial interaction'));
      console.log(chalk.magenta('2. Follow-up conversation - Testing context maintenance'));
      console.log(chalk.magenta('3. Token information - Testing blockchain data retrieval'));
      console.log(chalk.magenta('4. Wallet information - Testing on-chain wallet analysis'));
      console.log(chalk.magenta('5. Saving preferences - Testing memory retention'));
      console.log(chalk.magenta('6. Creating strategy - Testing complex object creation'));
      console.log(chalk.magenta('7. Listing conversations - Testing retrieval functions'));
      console.log(chalk.magenta('8. Semantic query - Testing ChromaDB integration'));
      console.log(chalk.magenta('\nStarting tests in 3 seconds...'));

      await new Promise(resolve => setTimeout(resolve, 3000));

      // Stats tracking
      const stats = {
        startTime: Date.now(),
        testsRun: 0,
        testsSucceeded: 0,
        testsFailed: 0,
        testsSkipped: 0
      };

      // Basic conversation test
      try {
        stats.testsRun++;
        await this.testBasicConversation();
        stats.testsSucceeded++;
      } catch (e) {
        stats.testsFailed++;
        console.error(chalk.red.bold('❌ Basic conversation test failed - this may affect subsequent tests'));
      }

      // Follow-up test
      try {
        stats.testsRun++;
        await this.testFollowUpConversation();
        stats.testsSucceeded++;
      } catch (e) {
        stats.testsFailed++;
      }

      // Token information test
      try {
        stats.testsRun++;
        await this.testTokenInformation();
        stats.testsSucceeded++;
      } catch (e) {
        stats.testsFailed++;
      }

      // Wallet information test
      try {
        stats.testsRun++;
        await this.testWalletInformation();
        stats.testsSucceeded++;
      } catch (e) {
        stats.testsFailed++;
      }

      // Saving preference test
      try {
        stats.testsRun++;
        await this.testSavingPreference();
        stats.testsSucceeded++;
      } catch (e) {
        stats.testsFailed++;
      }

      // Creating strategy test
      try {
        stats.testsRun++;
        await this.testCreatingStrategy();
        stats.testsSucceeded++;
      } catch (e) {
        stats.testsFailed++;
      }

      // List conversations test
      try {
        stats.testsRun++;
        await this.testListConversations();
        stats.testsSucceeded++;
      } catch (e) {
        stats.testsFailed++;
      }

      // Optional test - depends on ChromaDB setup
      try {
        if (process.env.CHROMA_SERVER_URL) {
          stats.testsRun++;
          await this.testSemanticQuery();
          stats.testsSucceeded++;
        } else {
          stats.testsSkipped++;
          this.logStep('Semantic query test skipped - ChromaDB is not configured');
        }
      } catch (e) {
        stats.testsFailed++;
        this.logStep('Semantic query test failed - ChromaDB may not be working correctly');
      }

      // Calculate and display stats
      const totalTime = ((Date.now() - stats.startTime) / 1000).toFixed(2);
      console.log(chalk.bgGreen.black.bold(`\n✅✅✅ TEST SUMMARY (${totalTime}s) ✅✅✅`));
      console.log(chalk.green(`✓ Tests run: ${stats.testsRun}`));
      console.log(chalk.green(`✓ Tests succeeded: ${stats.testsSucceeded}`));

      if (stats.testsFailed > 0) {
        console.log(chalk.red(`✗ Tests failed: ${stats.testsFailed}`));
      }

      if (stats.testsSkipped > 0) {
        console.log(chalk.yellow(`⚠ Tests skipped: ${stats.testsSkipped}`));
      }

      console.log(chalk.bgGreen.black.bold('\n✅✅✅ ALL TESTS COMPLETED ✅✅✅\n'));
    } catch (error) {
      console.error(chalk.bgRed.white.bold('\n❌❌❌ TEST FAILURES ❌❌❌\n'));
      console.error(chalk.red('General error:'), error);
      process.exit(1);
    }
  }
}

// Helper method for nice formatting of console output
function displayDivider() {
  console.log(chalk.gray('───────────────────────────────────────────────────────────────────────────────'));
}

// Run tests if file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  displayDivider();
  console.log(chalk.bgYellow.black.bold(' ConversationService Test Suite '));
  displayDivider();

  const tester = new ConversationServiceTest();
  tester.runAllTests().catch(error => {
    console.error('Unhandled error in test suite:', error);
    process.exit(1);
  });
}

export default ConversationServiceTest;
